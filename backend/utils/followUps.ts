import { Prisma } from '@prisma/client'
import { dateValue } from './validation'

/** All follow-up bucketing uses UTC calendar days, matching reminder dedupe keys. */
export type FollowUpBucket = 'overdue' | 'today' | 'upcoming'

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function nextUtcDay(date: Date): Date {
  return new Date(startOfUtcDay(date).getTime() + 24 * 60 * 60 * 1000)
}

export function followUpBucket(nextFollowUpAt: Date | string | null | undefined, now = new Date()): FollowUpBucket | null {
  if (!nextFollowUpAt) return null
  const due = nextFollowUpAt instanceof Date ? nextFollowUpAt : new Date(nextFollowUpAt)
  if (Number.isNaN(due.getTime())) return null
  const today = startOfUtcDay(now)
  if (due.getTime() < today.getTime()) return 'overdue'
  if (due.getTime() < nextUtcDay(now).getTime()) return 'today'
  return 'upcoming'
}

export function followUpWhere(bucket: FollowUpBucket, now = new Date()): Prisma.LeadWhereInput {
  const today = startOfUtcDay(now)
  const tomorrow = nextUtcDay(now)
  if (bucket === 'overdue') return { nextFollowUpAt: { lt: today } }
  if (bucket === 'today') return { nextFollowUpAt: { gte: today, lt: tomorrow } }
  return { nextFollowUpAt: { gte: tomorrow } }
}

/** Accepts a nullable date field while reusing the shared date validation. */
export function nullableDateValue(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  return dateValue(value, field)
}
