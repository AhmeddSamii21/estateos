import { Prisma } from '@prisma/client'
import { parseMoney } from './money'
import { dateValue, enumValue, failValidation, numberValue, ValidationError } from './validation'

export type InstallmentFrequency = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL'

export const INSTALLMENT_FREQUENCIES: readonly InstallmentFrequency[] = [
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUAL',
  'ANNUAL'
]

const MONTH_STEPS: Record<InstallmentFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12
}

/** UTC date in a later month, clamped to that month's last day. */
export function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate()
  const result = new Date(date.getTime())
  // Move to the first day before shifting months so day 31 never rolls over.
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

export interface InstallmentInput {
  dealAmount: unknown
  downPayment: unknown
  installmentCount: unknown
  frequency: InstallmentFrequency
  firstDueDate: unknown
}

export interface InstallmentRow {
  index: number
  amount: string
  dueAt: string
}

export interface InstallmentSchedule {
  downPayment: string
  financedAmount: string
  installmentCount: number
  frequency: InstallmentFrequency
  firstDueDate: string
  installments: InstallmentRow[]
  total: string
}

export function buildInstallmentSchedule(input: InstallmentInput): InstallmentSchedule {
  try {
    return buildSchedule(input)
  } catch (error) {
    // ValidationError carries per-field issues but a generic Error.message;
    // surface the field names so callers get actionable validation feedback.
    if (error instanceof ValidationError) {
      error.message = error.issues.map((issue) => `${issue.field}: ${issue.message}`).join(', ')
    }
    throw error
  }
}

function buildSchedule(input: InstallmentInput): InstallmentSchedule {
  const dealAmount = parseMoney(input.dealAmount, 'dealAmount', { required: true })
  if (dealAmount === undefined) failValidation('dealAmount', 'dealAmount is required')
  const downPayment = parseMoney(input.downPayment, 'downPayment') ?? '0.00'
  const down = new Prisma.Decimal(downPayment)
  if (down.isNegative()) failValidation('downPayment', 'downPayment cannot be negative')

  const count = numberValue(input.installmentCount, 'installmentCount', { required: true, min: 1, max: 120 })
  if (count === undefined || !Number.isInteger(count)) {
    failValidation('installmentCount', 'installmentCount must be an integer between 1 and 120')
  }
  const frequency = enumValue(input.frequency, 'frequency', INSTALLMENT_FREQUENCIES)
  const firstDue = dateValue(input.firstDueDate, 'firstDueDate', true)
  if (!firstDue) failValidation('firstDueDate', 'firstDueDate is required')

  const financed = new Prisma.Decimal(dealAmount).minus(down)
  if (financed.lte(0)) failValidation('financedAmount', 'financedAmount must be greater than zero')

  const base = financed.div(count).toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR)
  const remainder = financed.minus(base.times(count))
  const step = MONTH_STEPS[frequency]
  const firstDueDate = firstDue.toISOString().slice(0, 10)
  const installments: InstallmentRow[] = []
  for (let index = 1; index <= count; index += 1) {
    const amount = index === count ? base.plus(remainder) : base
    const due = addMonthsClamped(firstDue, step * (index - 1))
    installments.push({
      index,
      amount: amount.toFixed(2),
      dueAt: due.toISOString().slice(0, 10)
    })
  }

  return {
    downPayment: down.toFixed(2),
    financedAmount: financed.toFixed(2),
    installmentCount: count,
    frequency,
    firstDueDate,
    installments,
    total: dealAmount
  }
}

export function installmentPaymentReferences(batchKey: string, count: number): string[] {
  const safeKey = batchKey.replace(/[^A-Za-z0-9_-]/g, '')
  return Array.from({ length: count }, (_, index) => `INST-${safeKey}-${index + 1}`)
}
