import { DealStatus } from '@prisma/client'
import { createError } from '../middleware/errorHandler'

/** Allowed forward-only moves through the deal lifecycle. */
export const DEAL_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  [DealStatus.DRAFT]: [DealStatus.PENDING, DealStatus.ACTIVE, DealStatus.CANCELLED],
  [DealStatus.PENDING]: [DealStatus.ACTIVE, DealStatus.CANCELLED],
  [DealStatus.ACTIVE]: [DealStatus.COMPLETED, DealStatus.CANCELLED],
  [DealStatus.COMPLETED]: [],
  [DealStatus.CANCELLED]: []
}

/** A newly created deal must start in an open, not-yet-final stage. */
export const INITIAL_DEAL_STATUSES: DealStatus[] = [DealStatus.DRAFT, DealStatus.PENDING, DealStatus.ACTIVE]

export function assertInitialDealStatus(status: DealStatus): void {
  if (!INITIAL_DEAL_STATUSES.includes(status)) {
    throw createError(`Deals cannot be created with status ${status}`, 400)
  }
}

export function assertDealTransition(from: DealStatus, to: DealStatus): void {
  if (from === to) return
  if (!DEAL_TRANSITIONS[from]?.includes(to)) {
    throw createError(`Invalid deal status transition: ${from} to ${to}`, 400)
  }
}
