import { PaymentStatus, Prisma } from '@prisma/client'

export const PAYMENT_AGING_BUCKETS = ['CURRENT', '1_30_DAYS', '31_60_DAYS', '60_PLUS_DAYS', 'PAID'] as const
export type PaymentAgingBucket = (typeof PAYMENT_AGING_BUCKETS)[number]

export interface AgingPayment {
  amount: Prisma.Decimal | string | number
  baseAmount?: Prisma.Decimal | string | number | null
  currency?: string | null
  status: PaymentStatus
  dueAt: Date | null
  paidAt?: Date | null
  createdAt: Date
}

export interface PaymentAgingResult {
  bucket: PaymentAgingBucket
  daysPastDue: number
}

const DAY_MS = 86_400_000

/**
 * Settled payments are PAID regardless of age. Everything still open is aged
 * from its due date; rows without a due date and future dues are CURRENT. The
 * derived value is never persisted, so bucket boundaries move naturally with
 * time and match the database filters.
 */
export function paymentAgingBucket(payment: AgingPayment, now: Date = new Date()): PaymentAgingResult {
  if (payment.status === PaymentStatus.COMPLETED || payment.status === PaymentStatus.REFUNDED) {
    return { bucket: 'PAID', daysPastDue: 0 }
  }
  if (!payment.dueAt) return { bucket: 'CURRENT', daysPastDue: 0 }
  const elapsed = (now.getTime() - payment.dueAt.getTime()) / DAY_MS
  if (elapsed <= 0) return { bucket: 'CURRENT', daysPastDue: 0 }
  const daysPastDue = Math.floor(elapsed)
  if (elapsed <= 30) return { bucket: '1_30_DAYS', daysPastDue }
  if (elapsed <= 60) return { bucket: '31_60_DAYS', daysPastDue }
  return { bucket: '60_PLUS_DAYS', daysPastDue }
}

export interface AgingSummaryRow {
  count: number
  amount: string
  baseAmount: string
}

export type PaymentAgingSummary = Record<PaymentAgingBucket, AgingSummaryRow>

export function emptyPaymentAgingSummary(): PaymentAgingSummary {
  return {
    CURRENT: { count: 0, amount: '0.00', baseAmount: '0.00' },
    '1_30_DAYS': { count: 0, amount: '0.00', baseAmount: '0.00' },
    '31_60_DAYS': { count: 0, amount: '0.00', baseAmount: '0.00' },
    '60_PLUS_DAYS': { count: 0, amount: '0.00', baseAmount: '0.00' },
    PAID: { count: 0, amount: '0.00', baseAmount: '0.00' }
  }
}

export function buildPaymentAgingSummary(payments: AgingPayment[], now: Date = new Date()): PaymentAgingSummary {
  const summary = emptyPaymentAgingSummary()
  for (const payment of payments) {
    const { bucket } = paymentAgingBucket(payment, now)
    const row = summary[bucket]
    row.count += 1
    row.amount = new Prisma.Decimal(row.amount).plus(payment.amount).toFixed(2)
    const base = payment.baseAmount ?? payment.amount
    row.baseAmount = new Prisma.Decimal(row.baseAmount).plus(base).toFixed(2)
  }
  return summary
}

/** Prisma cannot filter on a derived value, so expand a bucket into status/due predicates. */
export function paymentAgingWhere(bucket: PaymentAgingBucket, now: Date = new Date()): Prisma.PaymentWhereInput {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS)
  switch (bucket) {
    case 'PAID':
      return { status: { in: [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED] } }
    case 'CURRENT':
      return {
        status: { notIn: [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED] },
        OR: [{ dueAt: null }, { dueAt: { gte: now } }]
      }
    case '1_30_DAYS':
      return {
        status: { notIn: [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED] },
        dueAt: { lt: now, gte: daysAgo(30) }
      }
    case '31_60_DAYS':
      return {
        status: { notIn: [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED] },
        dueAt: { lt: daysAgo(30), gte: daysAgo(60) }
      }
    case '60_PLUS_DAYS':
      return {
        status: { notIn: [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED] },
        dueAt: { lt: daysAgo(60) }
      }
  }
}
