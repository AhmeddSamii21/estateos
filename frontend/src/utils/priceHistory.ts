import type { PriceHistoryEntry, PropertyActivity } from '@/types'

export const PROPERTY_PRICE_CHANGED = 'PROPERTY_PRICE_CHANGED'

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

/** Turns the PROPERTY_PRICE_CHANGED activity payload into a timeline model. */
export function parsePriceHistory(activities: PropertyActivity[] | null | undefined): PriceHistoryEntry[] {
  return (activities || [])
    .filter((activity) => activity.action === PROPERTY_PRICE_CHANGED)
    .map((activity) => {
      let raw: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(activity.details || '{}')
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          raw = parsed as Record<string, unknown>
        }
      } catch {
        raw = {}
      }
      const price = raw.price && typeof raw.price === 'object' ? raw.price as Record<string, unknown> : {}
      const currencyPair = raw.currency && typeof raw.currency === 'object' ? raw.currency as Record<string, unknown> : {}
      return {
        id: activity.id,
        timestamp: activity.createdAt,
        oldPrice: text(raw.oldPrice ?? price.before),
        oldCurrency: text(raw.oldCurrency ?? currencyPair.before),
        newPrice: text(raw.newPrice ?? price.after),
        newCurrency: text(raw.newCurrency ?? currencyPair.after)
      }
    })
    .filter((entry) => entry.oldPrice || entry.newPrice || entry.oldCurrency || entry.newCurrency)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}
