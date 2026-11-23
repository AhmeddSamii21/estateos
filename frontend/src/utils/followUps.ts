export type FollowUpBucket = 'overdue' | 'today' | 'upcoming'

/** Mirrors the backend UTC-day bucketing used by lead reminders. */
export function followUpBucket(value: string | Date | null | undefined, now = new Date()): FollowUpBucket | null {
  if (!value) return null
  const due = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(due.getTime())) return null
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime()
  const tomorrow = today + 24 * 60 * 60 * 1000
  if (due.getTime() < today) return 'overdue'
  if (due.getTime() < tomorrow) return 'today'
  return 'upcoming'
}
