export type LeaseRenewalState = 'expired' | 'due' | 'upcoming'

/** Mirrors backend/utils/leases.ts so UI badges match reminder notifications. */
export function daysUntilLeaseEnd(leaseEndAt: string | Date, now = new Date()): number {
  const end = leaseEndAt instanceof Date ? leaseEndAt : new Date(leaseEndAt)
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((endDay - today) / (24 * 60 * 60 * 1000))
}

export function leaseRenewalState(
  lease: { leaseEndAt?: string | Date | null; renewalNoticeDays?: number | null; type?: string },
  now = new Date()
): LeaseRenewalState | null {
  if (!lease.leaseEndAt || lease.type === 'SALE') return null
  const end = lease.leaseEndAt instanceof Date ? lease.leaseEndAt : new Date(lease.leaseEndAt)
  if (Number.isNaN(end.getTime())) return null
  const days = daysUntilLeaseEnd(end, now)
  const notice = lease.renewalNoticeDays == null ? 30 : Math.max(0, Math.min(365, lease.renewalNoticeDays))
  if (days < 0) return 'expired'
  if (days <= notice) return 'due'
  return 'upcoming'
}
