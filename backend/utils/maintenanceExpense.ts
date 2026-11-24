import { ExpenseStatus, Prisma } from '@prisma/client'
import { createError } from '../middleware/errorHandler'
import { optionalString } from './validation'

export interface MaintenanceExpenseSource {
  id: string
  propertyId: string
  title: string
  cost: Prisma.Decimal | string | number | null
  currency: string | null | undefined
  completedAt?: Date | null
  assignedToId?: string | null
  notes?: string | null
}

export interface LinkedExpenseSummary {
  linkedExpenseId: string | null
  linkedExpenseStatus: string | null
  linkedExpenseAmount: string | null
  linkedExpenseCurrency: string | null
}

export function maintenanceExpenseKey(maintenanceId: string): string {
  return `MAINTENANCE-${maintenanceId}`
}

function costNumber(cost: unknown): number {
  if (cost === null || cost === undefined || cost === '') return 0
  const value = typeof cost === 'number' ? cost : Number(cost.toString())
  return Number.isFinite(value) ? value : 0
}

export function normalizeMaintenanceCurrency(value: unknown): string {
  // Validate the whole string ourselves so an invalid code reports the
  // actionable currency message instead of a generic length error.
  const code = (optionalString(value, 'currency', 20) || 'USD').toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) {
    throw createError('currency must be a 3-letter ISO currency code', 400)
  }
  return code
}

/** Only completion with a real cost creates an expense; flags opt out explicitly. */
export function shouldRecordMaintenanceExpense(input: {
  status: string
  cost: unknown
  recordExpense?: unknown
  linkedExpenseId?: string | null
}): boolean {
  if (input.status !== 'COMPLETED') return false
  if (input.linkedExpenseId) return false
  if (costNumber(input.cost) <= 0) return false
  if (input.recordExpense === false || input.recordExpense === 'false') return false
  return true
}

export function maintenanceExpenseData(
  source: MaintenanceExpenseSource,
  options: { note?: string | null } = {}
): Prisma.ExpenseCreateInput {
  const cost = costNumber(source.cost)
  if (cost <= 0) throw createError('Completed maintenance cost must be positive', 400)
  const currency = normalizeMaintenanceCurrency(source.currency)
  const description = `Maintenance: ${source.title}`.slice(0, 500)
  const meta = maintenanceExpenseKey(source.id)
  const notes = [options.note, source.notes, `Source: ${meta}`].filter(Boolean).join(' | ').slice(0, 2000) || null

  return {
    category: 'MAINTENANCE',
    description,
    amount: cost.toFixed(2),
    currency,
    status: ExpenseStatus.PAID,
    spentAt: source.completedAt || new Date(),
    paidAt: source.completedAt || new Date(),
    notes,
    property: { connect: { id: source.propertyId } },
    maintenanceRequest: { connect: { id: source.id } },
    ...(source.assignedToId ? { responsible: { connect: { id: source.assignedToId } } } : {})
  }
}

export function maintenanceExpenseWhere(maintenanceId: string): Prisma.ExpenseWhereInput {
  return { maintenanceRequestId: maintenanceId, deletedAt: null }
}

export function linkedExpenseSummary(expense: {
  id: string
  status: string
  amount: Prisma.Decimal | string | number
  currency: string
} | null | undefined): LinkedExpenseSummary {
  if (!expense) {
    return { linkedExpenseId: null, linkedExpenseStatus: null, linkedExpenseAmount: null, linkedExpenseCurrency: null }
  }
  return {
    linkedExpenseId: expense.id,
    linkedExpenseStatus: expense.status,
    linkedExpenseAmount: expense.amount.toString(),
    linkedExpenseCurrency: expense.currency
  }
}
