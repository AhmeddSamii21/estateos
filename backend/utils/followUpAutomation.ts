import { AppointmentType, AppointmentStatus, DealStatus, FollowUpChannel, FollowUpTaskStatus, FollowUpTrigger, LeadStatus, Prisma, type Role } from '@prisma/client'
import { prisma } from '../prisma'
import { logAudit } from './audit'
import { createError } from '../middleware/errorHandler'
import { leadScope } from './scope'

export const FOLLOW_UP_TRIGGERS = Object.values(FollowUpTrigger)
export const FOLLOW_UP_CHANNELS = Object.values(FollowUpChannel)
export const FOLLOW_UP_TASK_STATUSES = Object.values(FollowUpTaskStatus)

export const TRIGGER_LABELS: Record<FollowUpTrigger, [string, string]> = {
  [FollowUpTrigger.NEW_LEAD]: ['New lead', 'عميل محتمل جديد'],
  [FollowUpTrigger.NO_CONTACT]: ['No recent contact', 'لا يوجد تواصل حديث'],
  [FollowUpTrigger.VIEWING_NO_DEAL]: ['Viewing without deal', 'معاينة بدون صفقة'],
  [FollowUpTrigger.DEAL_STALLED]: ['Stalled deal', 'صفقة متوقفة']
}

export interface FollowUpCandidate {
  leadId: string | null
  dealId: string | null
  userId: string | null
  reason: FollowUpTrigger
  threshold: Date
  variables: Record<string, string>
  dayKey: string
}

export interface TaskDraft {
  title: string
  titleAr: string | null
  dueAt: Date
  sourceKey: string
  leadId: string | null
  dealId: string | null
  userId: string | null
}

/** Placeholder renderer only substitutes known values and never evaluates input. */
export function renderFollowUpTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (token, key: string) => variables[key] ?? token)
}

export function followUpDueAt(now: Date, conditionDays: number): Date {
  const days = Number.isFinite(conditionDays) && conditionDays > 0 ? conditionDays : 3
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}

export function buildTaskDraft(rule: {
  id: string
  trigger: FollowUpTrigger
  conditionDays: number
  template: string
  templateAr: string | null
}, candidate: FollowUpCandidate, now: Date): TaskDraft {
  const dueAt = followUpDueAt(now, rule.conditionDays)
  const entity = candidate.leadId ? `lead-${candidate.leadId}` : `deal-${candidate.dealId}`
  return {
    title: renderFollowUpTemplate(rule.template, candidate.variables).slice(0, 300),
    titleAr: rule.templateAr ? renderFollowUpTemplate(rule.templateAr, candidate.variables).slice(0, 300) : null,
    dueAt,
    sourceKey: `${rule.id}:${entity}:${candidate.dayKey}`,
    leadId: candidate.leadId,
    dealId: candidate.dealId,
    userId: candidate.userId
  }
}

function daysAgo(now: Date, days: number): Date {
  const count = Number.isFinite(days) && days >= 0 ? days : 3
  return new Date(now.getTime() - count * 24 * 60 * 60 * 1000)
}

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

async function candidatesFor(rule: {
  trigger: FollowUpTrigger
  conditionDays: number
}, organizationId: string, now: Date): Promise<FollowUpCandidate[]> {
  const cutoff = daysAgo(now, rule.conditionDays)
  const key = dayKey(now)
  if (rule.trigger === FollowUpTrigger.NEW_LEAD) {
    const leads = await prisma.lead.findMany({
      where: {
        deletedAt: null,
        status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED] },
        createdAt: { gte: cutoff, lte: now },
        ...leadScope(organizationId)
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        assignedToId: true,
        createdAt: true
      }
    })
    return leads.map((lead) => ({
      leadId: lead.id,
      dealId: null,
      userId: lead.assignedToId,
      reason: FollowUpTrigger.NEW_LEAD,
      threshold: cutoff,
      dayKey: key,
      variables: {
        client_name: `${lead.firstName} ${lead.lastName || ''}`.trim(),
        agent_name: '',
        deal_reference: '',
        due_date: followUpDueAt(now, rule.conditionDays).toISOString().slice(0, 10)
      }
    }))
  }

  if (rule.trigger === FollowUpTrigger.NO_CONTACT) {
    const leads = await prisma.lead.findMany({
      where: {
        deletedAt: null,
        status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
        OR: [
          { lastContactedAt: { lt: cutoff } },
          { lastContactedAt: null, createdAt: { lt: cutoff } }
        ],
        ...leadScope(organizationId)
      },
      select: { id: true, firstName: true, lastName: true, assignedToId: true, lastContactedAt: true }
    })
    return leads.map((lead) => ({
      leadId: lead.id,
      dealId: null,
      userId: lead.assignedToId,
      reason: FollowUpTrigger.NO_CONTACT,
      threshold: cutoff,
      dayKey: key,
      variables: {
        client_name: `${lead.firstName} ${lead.lastName || ''}`.trim(),
        agent_name: '',
        deal_reference: '',
        due_date: followUpDueAt(now, rule.conditionDays).toISOString().slice(0, 10)
      }
    }))
  }

  if (rule.trigger === FollowUpTrigger.VIEWING_NO_DEAL) {
    const appointments = await prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.COMPLETED,
        type: AppointmentType.VIEWING,
        startsAt: { gte: cutoff, lte: now },
        user: { organizationId },
        lead: leadScope(organizationId)
      },
      select: {
        leadId: true,
        userId: true,
        lead: { select: { id: true, firstName: true, lastName: true, deletedAt: true, deals: { select: { id: true } } } }
      }
    })
    const seen = new Set<string>()
    const candidates: FollowUpCandidate[] = []
    for (const appointment of appointments) {
      const lead = appointment.lead
      if (!lead || lead.deletedAt || lead.deals.length || !lead.id || seen.has(lead.id)) continue
      seen.add(lead.id)
      candidates.push({
        leadId: lead.id,
        dealId: null,
        userId: appointment.userId || null,
        reason: FollowUpTrigger.VIEWING_NO_DEAL,
        threshold: cutoff,
        dayKey: key,
        variables: {
          client_name: `${lead.firstName} ${lead.lastName || ''}`.trim(),
          agent_name: '',
          deal_reference: '',
          due_date: followUpDueAt(now, rule.conditionDays).toISOString().slice(0, 10)
        }
      })
    }
    return candidates
  }

  const deals = await prisma.deal.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { in: [DealStatus.DRAFT, DealStatus.PENDING, DealStatus.ACTIVE] },
      updatedAt: { lt: cutoff }
    },
    select: {
      id: true,
      referenceNumber: true,
      userId: true,
      lead: { select: { firstName: true, lastName: true } }
    }
  })
  return deals.map((deal) => ({
    leadId: null,
    dealId: deal.id,
    userId: deal.userId,
    reason: FollowUpTrigger.DEAL_STALLED,
    threshold: cutoff,
    dayKey: key,
    variables: {
      client_name: deal.lead ? `${deal.lead.firstName} ${deal.lead.lastName || ''}`.trim() : '',
      agent_name: '',
      deal_reference: deal.referenceNumber || deal.id,
      due_date: followUpDueAt(now, rule.conditionDays).toISOString().slice(0, 10)
    }
  }))
}

export interface AutomationResult {
  evaluatedRules: number
  created: number
  skipped: number
  tasks: Array<{ id: string; title: string; status: FollowUpTaskStatus; dueAt: Date; sourceKey: string | null }>
}

/** Idempotent per rule, entity and UTC day: repeated runs never duplicate work. */
export async function runFollowUpAutomation(
  organizationId: string,
  now = new Date(),
  actorUserId?: string
): Promise<AutomationResult> {
  const rules = await prisma.followUpRule.findMany({
    where: { organizationId, deletedAt: null, isActive: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]
  })
  const result: AutomationResult = { evaluatedRules: rules.length, created: 0, skipped: 0, tasks: [] }

  for (const rule of rules) {
    const candidates = await candidatesFor(rule, organizationId, now)
    for (const candidate of candidates) {
      const draft = buildTaskDraft(rule, candidate, now)
      const existing = await prisma.followUpTask.findUnique({ where: { sourceKey: draft.sourceKey } })
      if (existing) {
        result.skipped += 1
        continue
      }
      const task = await prisma.followUpTask.create({
        data: {
          organizationId,
          ruleId: rule.id,
          leadId: draft.leadId,
          dealId: draft.dealId,
          userId: draft.userId,
          title: draft.title,
          titleAr: draft.titleAr,
          dueAt: draft.dueAt,
          status: FollowUpTaskStatus.PENDING,
          sourceKey: draft.sourceKey
        },
        select: { id: true, title: true, status: true, dueAt: true, sourceKey: true }
      })
      result.created += 1
      result.tasks.push(task)
    }
  }

  if (actorUserId && result.created) {
    await logAudit(prisma, {
      userId: actorUserId,
      action: 'FOLLOW_UP_AUTOMATION_RUN',
      entityType: 'FollowUpTask',
      entityId: organizationId,
      details: { created: result.created, skipped: result.skipped, rules: result.evaluatedRules }
    })
  }
  return result
}

export function assertTrigger(value: unknown): FollowUpTrigger {
  if (typeof value !== 'string' || !FOLLOW_UP_TRIGGERS.includes(value as FollowUpTrigger)) {
    throw createError('Invalid follow-up trigger', 400)
  }
  return value as FollowUpTrigger
}

export function assertChannel(value: unknown): FollowUpChannel {
  if (typeof value !== 'string' || !FOLLOW_UP_CHANNELS.includes(value as FollowUpChannel)) {
    throw createError('Invalid follow-up channel', 400)
  }
  return value as FollowUpChannel
}

export function taskScope(organizationId: string, role: Role, userId: string): Prisma.FollowUpTaskWhereInput {
  if (role === 'AGENT') return { organizationId, userId }
  return { organizationId }
}
