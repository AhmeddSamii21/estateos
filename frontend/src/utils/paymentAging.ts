import type { PaymentAgingBucket } from '@/types'

export const PAYMENT_AGING_BUCKETS: PaymentAgingBucket[] = [
  'CURRENT',
  '1_30_DAYS',
  '31_60_DAYS',
  '60_PLUS_DAYS',
  'PAID'
]

const LABELS: Record<PaymentAgingBucket, [string, string]> = {
  CURRENT: ['Current', 'حالية'],
  '1_30_DAYS': ['1–30 days', '١–٣٠ يومًا'],
  '31_60_DAYS': ['31–60 days', '٣١–٦٠ يومًا'],
  '60_PLUS_DAYS': ['60+ days', 'أكثر من ٦٠ يومًا'],
  PAID: ['Paid', 'مدفوعة']
}

export function agingLabel(bucket: PaymentAgingBucket, isArabic: boolean): string {
  const pair = LABELS[bucket] || [bucket, bucket]
  return isArabic ? pair[1] : pair[0]
}
