import { CommissionStatus, Prisma, Role } from '@prisma/client'
import { createError } from '../middleware/errorHandler'

/** Cancelled commissions are excluded from payout statements. */
export const STATEMENT_STATUSES: CommissionStatus[] = [
  CommissionStatus.PENDING,
  CommissionStatus.APPROVED,
  CommissionStatus.PAID
]

interface StatementUser {
  id: string
  email: string
  firstName?: string | null
}

export interface StatementCommissionRow {
  id: string
  amount: Prisma.Decimal | string
  currency: string
  status: CommissionStatus
  userId: string | null
  baseAmount?: Prisma.Decimal | string | null
  user?: StatementUser | null
  deal: {
    id?: string
    referenceNumber?: string | null
    userId: string
    user?: StatementUser | null
  }
}

export interface StatementLine {
  agentId: string
  agentName: string
  status: CommissionStatus
  currency: string
  count: number
  amount: string
  baseAmount: string | null
}

export interface StatementTotal {
  status: CommissionStatus
  currency: string
  count: number
  amount: string
}

/**
 * Agents are limited to commissions assigned to them, including legacy rows
 * with no commission.userId where the deal itself identifies the agent.
 */
export function commissionStatementScope(
  role: Role | undefined,
  actorId: string,
  organizationId: string,
  agentId?: string | null
): Prisma.CommissionWhereInput {
  if (role === Role.AGENT && agentId && agentId !== actorId) {
    throw createError('Agents can only view their own commission statement', 403)
  }
  const where: Prisma.CommissionWhereInput = {
    deletedAt: null,
    status: { in: STATEMENT_STATUSES },
    deal: { organizationId, deletedAt: null }
  }
  if (role === Role.AGENT) {
    where.OR = [{ userId: actorId }, { userId: null, deal: { userId: actorId } }]
  } else if (agentId) {
    where.OR = [{ userId: agentId }, { userId: null, deal: { userId: agentId } }]
  }
  return where
}

function decimal(value: Prisma.Decimal | string | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined || value === '') return new Prisma.Decimal(0)
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value))
}

export function agentIdentity(row: StatementCommissionRow): { id: string; label: string } {
  const user = row.user || row.deal.user
  return {
    id: row.userId || row.deal.userId,
    label: (user?.firstName && user.firstName.trim()) || user?.email || row.userId || row.deal.userId
  }
}

/** Groups active commissions by agent, status and source currency. */
export function buildCommissionStatement(rows: StatementCommissionRow[]): {
  lines: StatementLine[]
  totals: StatementTotal[]
  fxRows: Array<{ currency: string; amount: string }>
} {
  const grouped = new Map<string, {
    agentId: string
    agentName: string
    status: CommissionStatus
    currency: string
    count: number
    amount: Prisma.Decimal
    baseAmount: Prisma.Decimal
    hasBase: boolean
  }>()

  for (const row of rows) {
    if (!STATEMENT_STATUSES.includes(row.status)) continue
    const agent = agentIdentity(row)
    const currency = (row.currency || 'UNSPECIFIED').toUpperCase()
    const key = `${agent.id}|${row.status}|${currency}`
    const current = grouped.get(key) || {
      agentId: agent.id,
      agentName: agent.label,
      status: row.status,
      currency,
      count: 0,
      amount: new Prisma.Decimal(0),
      baseAmount: new Prisma.Decimal(0),
      hasBase: false
    }
    current.count += 1
    current.amount = current.amount.plus(decimal(row.amount))
    if (row.baseAmount !== null && row.baseAmount !== undefined) {
      current.baseAmount = current.baseAmount.plus(decimal(row.baseAmount))
      current.hasBase = true
    }
    grouped.set(key, current)
  }

  const all = Array.from(grouped.values()).sort((a, b) =>
    a.agentName.localeCompare(b.agentName) ||
    STATEMENT_STATUSES.indexOf(a.status) - STATEMENT_STATUSES.indexOf(b.status) ||
    a.currency.localeCompare(b.currency)
  )
  const lines: StatementLine[] = all.map((row) => ({
    agentId: row.agentId,
    agentName: row.agentName,
    status: row.status,
    currency: row.currency,
    count: row.count,
    amount: row.amount.toFixed(2),
    baseAmount: row.hasBase ? row.baseAmount.toFixed(2) : null
  }))

  const totalsByKey = new Map<string, StatementTotal>()
  const byCurrency = new Map<string, Prisma.Decimal>()
  for (const line of lines) {
    const totalKey = `${line.status}|${line.currency}`
    const total = totalsByKey.get(totalKey) || {
      status: line.status,
      currency: line.currency,
      count: 0,
      amount: '0.00'
    }
    total.count += line.count
    total.amount = decimal(total.amount).plus(line.amount).toFixed(2)
    totalsByKey.set(totalKey, total)
    byCurrency.set(line.currency, (byCurrency.get(line.currency) || new Prisma.Decimal(0)).plus(line.amount))
  }

  return {
    lines,
    totals: Array.from(totalsByKey.values()).sort((a, b) =>
      STATEMENT_STATUSES.indexOf(a.status) - STATEMENT_STATUSES.indexOf(b.status) ||
      a.currency.localeCompare(b.currency)
    ),
    fxRows: Array.from(byCurrency.entries())
      .map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) }))
      .sort((a, b) => a.currency.localeCompare(b.currency))
  }
}
