export interface CompareRow {
  key: string
  label: string
  values: string[]
}

export interface CompareProperty {
  id?: string
  title?: string | null
  referenceNumber?: string | null
  price?: string | number | null
  currency?: string | null
  area?: string | number | null
  areaUnit?: string | null
  bedrooms?: string | number | null
  bathrooms?: string | number | null
  city?: string | null
  state?: string | null
  country?: string | null
  address?: string | null
  projectName?: string | null
  buildingName?: string | null
  paymentTerms?: string | null
  negotiable?: boolean | null
  features?: string | null
  images?: Array<{ url?: string | null; isPrimary?: boolean | null }>
}

export const COMPARE_METRIC_KEYS: readonly string[]
export const COMPARE_MIN: number
export const COMPARE_MAX: number

export function pricePerSqm(property: CompareProperty): number | null
export function validateCompareSelection(ids: unknown): string[]
export function buildCompareRows(properties: CompareProperty[], language?: 'en' | 'ar'): CompareRow[]
export function buildCompareSummary(properties: CompareProperty[], language?: 'en' | 'ar'): string
export function buildCompareWhatsAppMessage(properties: CompareProperty[], language?: 'en' | 'ar'): string
