import { DealStatus, LeadStatus, Prisma } from '@prisma/client'
import { leadScope } from './scope'

export const UNCONTACTED_SLA_HOURS = 24

export const FUNNEL_STAGES = ['new', 'engaged', 'viewing', 'won', 'closedDeals'] as const
export type FunnelStage = typeof FUNNEL_STAGES[number]

export interface FunnelInput {
  leadCounts: Partial<Record<LeadStatus | string, number>>
  dealCounts: Partial<Record<DealStatus | string, number>>
}

export interface FunnelStageRow {
  stage: FunnelStage
  label: string
  count: number
  conversionRate: number
}

export interface FunnelMetrics {
  leads: {
    total: number
    new: number
    engaged: number
    viewing: number
    won: number
  }
  deals: {
    total: number
    closed: number
  }
  stages: FunnelStageRow[]
  conversionRates: {
    newToEngaged: number
    engagedToViewing: number
    viewingToWon: number
    leadToClosedDeal: number
  }
}

function count(record: Partial<Record<string, number>>, key: string): number {
  return record[key] ?? 0
}

export function conversionRate(countAtStage: number, base: number): number {
  if (base <= 0) return 0
  return Math.round((countAtStage / base) * 10000) / 10000
}

/** Funnel counts come from grouped DB rows; this function is intentionally pure. */
export function buildFunnelMetrics(input: FunnelInput): FunnelMetrics {
  const { leadCounts, dealCounts } = input
  const leads = {
    total: Object.values(LeadStatus).reduce((sum, status) => sum + count(leadCounts, status), 0),
    new: count(leadCounts, LeadStatus.NEW),
    engaged: count(leadCounts, LeadStatus.CONTACTED) + count(leadCounts, LeadStatus.QUALIFIED),
    viewing: count(leadCounts, LeadStatus.VIEWING),
    won: count(leadCounts, LeadStatus.WON)
  }
  const deals = {
    total: Object.values(DealStatus).reduce((sum, status) => sum + count(dealCounts, status), 0),
    closed: count(dealCounts, DealStatus.COMPLETED)
  }

  const stages: FunnelStageRow[] = [
    { stage: 'new', label: 'New leads', count: leads.new, conversionRate: 1 },
    { stage: 'engaged', label: 'Contacted / Qualified', count: leads.engaged, conversionRate: conversionRate(leads.engaged, leads.new) },
    { stage: 'viewing', label: 'Viewing', count: leads.viewing, conversionRate: conversionRate(leads.viewing, leads.engaged) },
    { stage: 'won', label: 'Won leads', count: leads.won, conversionRate: conversionRate(leads.won, leads.viewing) },
    { stage: 'closedDeals', label: 'Closed deals', count: deals.closed, conversionRate: conversionRate(deals.closed, leads.won) }
  ]

  return {
    leads,
    deals,
    stages,
    conversionRates: {
      newToEngaged: conversionRate(leads.engaged, leads.new),
      engagedToViewing: conversionRate(leads.viewing, leads.engaged),
      viewingToWon: conversionRate(leads.won, leads.viewing),
      leadToClosedDeal: conversionRate(deals.closed, leads.total)
    }
  }
}

/** NEW + never contacted + older than the SLA window, scoped to the tenant. */
export function uncontactedLeadWhere(
  organizationId: string,
  options: { now?: Date; hours?: number } = {}
): Prisma.LeadWhereInput {
  const now = options.now || new Date()
  const hours = options.hours ?? UNCONTACTED_SLA_HOURS
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000)
  return {
    ...leadScope(organizationId),
    status: LeadStatus.NEW,
    lastContactedAt: null,
    isActive: true,
    deletedAt: null,
    createdAt: { lt: cutoff }
  }
}

export interface UncontactedLeadRow {
  id: string
  firstName: string
  lastName?: string | null
  email?: string | null
  phone?: string | null
  createdAt: Date | string
  assignedTo?: { email?: string | null } | null
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function uncontactedLeadCsv(rows: UncontactedLeadRow[], now = new Date()): string {
  const header = ['leadId', 'name', 'email', 'phone', 'createdAt', 'ageHours', 'assignedTo']
  const lines = [header.join(',')]
  for (const row of rows) {
    const created = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)
    const ageHours = Number.isNaN(created.getTime()) ? '' : String(Math.max(0, Math.floor((now.getTime() - created.getTime()) / 3600000)))
    lines.push([
      row.id,
      `${row.firstName}${row.lastName ? ` ${row.lastName}` : ''}`,
      row.email,
      row.phone,
      created.toISOString(),
      ageHours,
      row.assignedTo?.email
    ].map(csvCell).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

export function uncontactedReminderKey(
  userId: string,
  organizationId: string,
  leadId: string,
  day: string
): string {
  return `${userId}|${organizationId}|NEW_LEAD_UNCONTACTED|Lead|${leadId}|${day}`
}
