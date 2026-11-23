import { createError } from '../middleware/errorHandler'
import { numberValue } from './validation'

export const DEFAULT_RENEWAL_NOTICE_DAYS = 30
export const MAX_RENEWAL_NOTICE_DAYS = 365

export interface LeaseFields {
  leaseStartAt?: Date | null
  leaseEndAt?: Date | null
  renewalNoticeDays?: number | null
}

export interface LeaseAlertFields {
  leaseEndAt?: Date | string | null
  renewalNoticeDays?: number | null
  type?: string
}

export type LeaseRenewalState = 'expired' | 'due' | 'upcoming'

/**
 * Validates the effective (existing + incoming) lease values. An incomplete
 * window is allowed; a complete one must end after it starts.
 */
export function assertValidLease(fields: LeaseFields): void {
  if (fields.renewalNoticeDays !== undefined && fields.renewalNoticeDays !== null) {
    const notice = numberValue(fields.renewalNoticeDays, 'renewalNoticeDays', {
      min: 0,
      max: MAX_RENEWAL_NOTICE_DAYS
    })
    if (notice !== undefined && !Number.isInteger(notice)) {
      throw createError('renewalNoticeDays must be an integer', 400)
    }
  }
  if (fields.leaseStartAt && fields.leaseEndAt && fields.leaseEndAt.getTime() <= fields.leaseStartAt.getTime()) {
    throw createError('leaseEndAt must be after leaseStartAt', 400)
  }
}

/** Whole UTC days from today until the lease end (negative once expired). */
export function daysUntilLeaseEnd(leaseEndAt: Date | string, now = new Date()): number {
  const end = leaseEndAt instanceof Date ? leaseEndAt : new Date(leaseEndAt)
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((endDay - today) / (24 * 60 * 60 * 1000))
}

export function leaseRenewalState(
  deal: LeaseAlertFields,
  now = new Date()
): LeaseRenewalState | null {
  if (!deal.leaseEndAt || deal.type === 'SALE') return null
  const end = deal.leaseEndAt instanceof Date ? deal.leaseEndAt : new Date(deal.leaseEndAt)
  if (Number.isNaN(end.getTime())) return null
  const days = daysUntilLeaseEnd(end, now)
  const notice = deal.renewalNoticeDays == null
    ? DEFAULT_RENEWAL_NOTICE_DAYS
    : Math.min(MAX_RENEWAL_NOTICE_DAYS, Math.max(0, deal.renewalNoticeDays))
  if (days < 0) return 'expired'
  if (days <= notice) return 'due'
  return 'upcoming'
}

export function isLeaseRenewalDue(deal: LeaseAlertFields, now = new Date()): boolean {
  const state = leaseRenewalState(deal, now)
  return state === 'expired' || state === 'due'
}
