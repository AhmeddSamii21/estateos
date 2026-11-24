import { Prisma } from '@prisma/client'

/**
 * Structured price/currency change metadata shared by PropertyActivity and
 * AuditLog. The explicit old/new keys make the event self-describing, while
 * the price/currency before/after pairs are understood by ActivityTimeline.
 */
export const PROPERTY_PRICE_CHANGED = 'PROPERTY_PRICE_CHANGED'

export interface PricePair {
  before: string
  after: string
}

export interface PriceChangeMetadata {
  oldPrice: string
  oldCurrency: string
  newPrice: string
  newCurrency: string
  price: PricePair
  currency: PricePair
}

export interface PriceLike {
  toString(): string
}

export interface PriceSource {
  price: PriceLike
  currency: string | null | undefined
}

function money(value: PriceLike): string {
  const text = value.toString().trim()
  try {
    return new Prisma.Decimal(text).toFixed(2)
  } catch {
    return text
  }
}

function currency(value: string | null | undefined): string {
  const code = (value || '').trim().toUpperCase()
  return code || 'UNSPECIFIED'
}

export function priceChangeMetadata(existing: PriceSource, next: PriceSource): PriceChangeMetadata | null {
  const oldPrice = money(existing.price)
  const newPrice = money(next.price)
  const oldCurrency = currency(existing.currency)
  const newCurrency = currency(next.currency)
  if (oldPrice === newPrice && oldCurrency === newCurrency) return null
  return {
    oldPrice,
    oldCurrency,
    newPrice,
    newCurrency,
    price: { before: oldPrice, after: newPrice },
    currency: { before: oldCurrency, after: newCurrency }
  }
}

export interface PriceHistoryEntry {
  id: string
  timestamp: string
  userId?: string | null
  oldPrice: string
  oldCurrency: string
  newPrice: string
  newCurrency: string
}

interface RawActivity {
  id: string
  action: string
  details?: string | null
  createdAt: Date | string
  userId?: string | null
}

/** Reads price history from property activities without trusting stored JSON. */
export function parsePriceHistory(activities: RawActivity[] | null | undefined): PriceHistoryEntry[] {
  return (activities || [])
    .filter((activity) => activity && activity.action === PROPERTY_PRICE_CHANGED)
    .map((activity) => {
      let raw: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(activity.details || '{}')
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>
      } catch {
        raw = {}
      }
      const price = raw.price && typeof raw.price === 'object' ? raw.price as Record<string, unknown> : {}
      const currencyPair = raw.currency && typeof raw.currency === 'object' ? raw.currency as Record<string, unknown> : {}
      const text = (value: unknown) => value === undefined || value === null ? '' : String(value)
      return {
        id: activity.id,
        timestamp: activity.createdAt instanceof Date ? activity.createdAt.toISOString() : String(activity.createdAt),
        userId: activity.userId ?? null,
        oldPrice: text(raw.oldPrice ?? price.before),
        oldCurrency: text(raw.oldCurrency ?? currencyPair.before),
        newPrice: text(raw.newPrice ?? price.after),
        newCurrency: text(raw.newCurrency ?? currencyPair.after)
      }
    })
    .filter((entry) => entry.oldPrice || entry.newPrice || entry.oldCurrency || entry.newCurrency)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}
