import { MaintenanceRecurrenceInterval } from '@prisma/client'
import { enumValue } from './validation'

export const RECURRENCE_INTERVALS = Object.values(MaintenanceRecurrenceInterval)

/** Calendar months per interval. NONE never produces a next due date. */
const INTERVAL_MONTHS: Record<MaintenanceRecurrenceInterval, number> = {
  [MaintenanceRecurrenceInterval.NONE]: 0,
  [MaintenanceRecurrenceInterval.MONTHLY]: 1,
  [MaintenanceRecurrenceInterval.QUARTERLY]: 3,
  [MaintenanceRecurrenceInterval.SEMI_ANNUAL]: 6
}

export function parseRecurrenceInterval(
  value: unknown,
  fallback: MaintenanceRecurrenceInterval = MaintenanceRecurrenceInterval.NONE
): MaintenanceRecurrenceInterval {
  if (value === undefined || value === null || value === '') return fallback
  return enumValue(value, 'recurrenceInterval', RECURRENCE_INTERVALS)
}

/** Adds whole calendar months, clamping the day to the target month's length. */
export function addRecurrenceMonths(date: Date, interval: MaintenanceRecurrenceInterval): Date | null {
  const months = INTERVAL_MONTHS[interval]
  if (!months) return null
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + months
  const targetYear = year + Math.floor(month / 12)
  const targetMonth = ((month % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const day = Math.min(date.getUTCDate(), lastDay)
  return new Date(Date.UTC(targetYear, targetMonth, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()))
}

/**
 * The first actionable due date for a cycle. An explicit due date wins;
 * otherwise the interval is measured from the supplied reference time.
 */
export function initialRecurrenceDue(
  interval: MaintenanceRecurrenceInterval,
  dueAt: Date | null | undefined,
  now: Date = new Date()
): Date | null {
  if (interval === MaintenanceRecurrenceInterval.NONE) return null
  return dueAt ?? addRecurrenceMonths(now, interval)
}
