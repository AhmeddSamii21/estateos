/**
 * Package 32: frequency and date helpers now live in the pure calculator core
 * so the tested implementation is shared with the mortgage simulator.
 */
import { INSTALLMENT_MONTH_STEPS, addMonthsClamped } from './paymentCalculatorCore.mjs'
import type { InstallmentFrequency } from './paymentCalculatorCore.mjs'

export { INSTALLMENT_FREQUENCIES, INSTALLMENT_MONTH_STEPS, addMonthsClamped } from './paymentCalculatorCore.mjs'
export type { InstallmentFrequency } from './paymentCalculatorCore.mjs'

export interface InstallmentPreviewRow {
  index: number
  amount: string
  dueAt: string
}

function toCents(value: number | string, label: string): number {
  const amount = Number(value)
  if (!Number.isFinite(amount)) throw new Error(`${label} must be a valid number.`)
  return Math.round(amount * 100)
}

function money(cents: number): string {
  return (cents / 100).toFixed(2)
}

function parseFirstDueDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '')
  if (!match) throw new Error('First due date must be a valid date.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('First due date must be a valid date.')
  }
  return date
}

export function previewInstallments(input: {
  dealAmount: number | string
  downPayment: number | string
  installmentCount: number | string
  frequency: InstallmentFrequency
  firstDueDate: string
}): {
  downPayment: string
  financedAmount: string
  installmentCount: number
  frequency: InstallmentFrequency
  firstDueDate: string
  installments: InstallmentPreviewRow[]
  total: string
} {
  const count = Number(input.installmentCount)
  if (!Number.isInteger(count) || count < 1 || count > 120) {
    throw new Error('installmentCount must be a whole number between 1 and 120.')
  }

  const dealCents = toCents(input.dealAmount, 'dealAmount')
  const downCents = toCents(input.downPayment, 'downPayment')
  if (downCents < 0) throw new Error('downPayment cannot be negative.')
  if (downCents > dealCents) throw new Error('downPayment cannot exceed the financed deal amount.')

  const firstDate = parseFirstDueDate(input.firstDueDate)
  const step = INSTALLMENT_MONTH_STEPS[input.frequency]
  if (!step) throw new Error('frequency must be one of MONTHLY, QUARTERLY, SEMI_ANNUAL or ANNUAL.')

  const financedCents = dealCents - downCents
  const baseCents = Math.floor(financedCents / count)
  const remainder = financedCents - baseCents * count
  const installments: InstallmentPreviewRow[] = []
  for (let index = 1; index <= count; index += 1) {
    const cents = baseCents + (index === count ? remainder : 0)
    const due = addMonthsClamped(firstDate, step * (index - 1))
    installments.push({
      index,
      amount: money(cents),
      dueAt: due.toISOString().slice(0, 10)
    })
  }

  const financedAmount = money(financedCents)
  return {
    downPayment: money(downCents),
    financedAmount,
    installmentCount: count,
    frequency: input.frequency,
    firstDueDate: input.firstDueDate,
    installments,
    total: money(dealCents)
  }
}

export function formatInstallmentDate(value: string): string {
  if (!value) return '—'
  try {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
    const date = dateOnly ? new Date(`${value}T00:00:00Z`) : new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString(undefined, dateOnly ? { timeZone: 'UTC' } : undefined)
  } catch {
    return value
  }
}
