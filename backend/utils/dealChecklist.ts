import type { Prisma } from '@prisma/client'
import type { prisma } from '../prisma'

export const CLOSING_CHECKLIST_ITEMS = [
  { itemKey: 'PAYMENT_SETTLED', label: 'Payment settled' },
  { itemKey: 'DOCUMENTS_COMPLETE', label: 'Documents complete' },
  { itemKey: 'CONTRACT_SIGNED', label: 'Contract signed' },
  { itemKey: 'HANDOVER_CONFIRMED', label: 'Handover confirmed' }
] as const

export type ClosingChecklistItemKey = (typeof CLOSING_CHECKLIST_ITEMS)[number]['itemKey']
export type ChecklistClient = Prisma.TransactionClient | typeof prisma

export function isClosingChecklistItemKey(value: string): value is ClosingChecklistItemKey {
  return CLOSING_CHECKLIST_ITEMS.some((item) => item.itemKey === value)
}

/** Idempotently materialises the standard checklist for old and new deals. */
export async function ensureClosingChecklist(
  client: ChecklistClient,
  deal: { id: string; organizationId: string }
): Promise<void> {
  await client.dealClosingChecklist.createMany({
    data: CLOSING_CHECKLIST_ITEMS.map((item) => ({
      dealId: deal.id,
      organizationId: deal.organizationId,
      itemKey: item.itemKey,
      label: item.label
    })),
    skipDuplicates: true
  })
}

export interface ChecklistItemView {
  id: string
  itemKey: string
  label: string
  isCompleted: boolean
  completedAt: Date | null
  completedById: string | null
}

export interface ChecklistProgress {
  completed: number
  total: number
  isComplete: boolean
  items: ChecklistItemView[]
}

export function checklistProgress(items: ChecklistItemView[]): ChecklistProgress {
  const completed = items.filter((item) => item.isCompleted).length
  return {
    completed,
    total: items.length,
    isComplete: items.length > 0 && completed === items.length,
    items
  }
}
