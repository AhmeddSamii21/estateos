import { PropertyStatus } from '@prisma/client'
import { validatePropertyTransition } from './propertyStatus'

export const BOARD_STATUSES = [
  PropertyStatus.AVAILABLE,
  PropertyStatus.RESERVED,
  PropertyStatus.SOLD,
  PropertyStatus.RENTED,
  PropertyStatus.OFF_MARKET
] as const
export type BoardStatus = typeof BOARD_STATUSES[number]

export function isBoardStatus(value: unknown): value is BoardStatus {
  return typeof value === 'string' && (BOARD_STATUSES as readonly string[]).includes(value)
}

export interface BoardProperty {
  id: string
  status: PropertyStatus | string
}

export function groupByBoardStatus<T extends BoardProperty>(rows: T[]): Record<BoardStatus, T[]> {
  const groups = {
    [PropertyStatus.AVAILABLE]: [] as T[],
    [PropertyStatus.RESERVED]: [] as T[],
    [PropertyStatus.SOLD]: [] as T[],
    [PropertyStatus.RENTED]: [] as T[],
    [PropertyStatus.OFF_MARKET]: [] as T[]
  }
  for (const row of rows) {
    if (isBoardStatus(row.status)) groups[row.status].push(row)
  }
  return groups
}

/** Quick board moves reuse the canonical transition table; SOLD stays terminal. */
export function assertBoardTransition(from: PropertyStatus, to: PropertyStatus): void {
  if (!isBoardStatus(to)) {
    throw new Error(`Unsupported board status: ${to}`)
  }
  validatePropertyTransition(from, to)
}

export function boardQuickTransitions(from: PropertyStatus): BoardStatus[] {
  return BOARD_STATUSES.filter((status) => {
    if (status === from) return false
    try {
      assertBoardTransition(from, status)
      return true
    } catch {
      return false
    }
  })
}
