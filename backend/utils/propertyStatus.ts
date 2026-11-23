import { PropertyStatus } from '@prisma/client'
import { createError } from '../middleware/errorHandler'

export const PROPERTY_TRANSITIONS: Record<PropertyStatus, PropertyStatus[]> = {
  [PropertyStatus.AVAILABLE]: [PropertyStatus.PENDING, PropertyStatus.RESERVED, PropertyStatus.UNDER_NEGOTIATION, PropertyStatus.SOLD, PropertyStatus.RENTED, PropertyStatus.OFF_MARKET, PropertyStatus.UNAVAILABLE],
  [PropertyStatus.PENDING]: [PropertyStatus.AVAILABLE, PropertyStatus.RESERVED, PropertyStatus.UNDER_NEGOTIATION, PropertyStatus.SOLD, PropertyStatus.RENTED, PropertyStatus.UNAVAILABLE],
  [PropertyStatus.RESERVED]: [PropertyStatus.AVAILABLE, PropertyStatus.PENDING, PropertyStatus.UNDER_NEGOTIATION, PropertyStatus.SOLD, PropertyStatus.RENTED, PropertyStatus.UNAVAILABLE],
  [PropertyStatus.SOLD]: [],
  [PropertyStatus.RENTED]: [PropertyStatus.AVAILABLE],
  [PropertyStatus.OFF_MARKET]: [PropertyStatus.AVAILABLE],
  [PropertyStatus.UNAVAILABLE]: [PropertyStatus.AVAILABLE],
  [PropertyStatus.UNDER_NEGOTIATION]: [PropertyStatus.AVAILABLE, PropertyStatus.PENDING, PropertyStatus.RESERVED, PropertyStatus.SOLD, PropertyStatus.UNAVAILABLE]
}

export function validatePropertyTransition(from: PropertyStatus, to: PropertyStatus): void {
  if (from === to) return
  const allowed = PROPERTY_TRANSITIONS[from] ?? []
  if (!allowed.includes(to)) {
    throw createError(`Invalid property status transition: ${from} to ${to}`, 400)
  }
}

export function isTerminalStatus(status: PropertyStatus): boolean {
  return status === PropertyStatus.SOLD
}
