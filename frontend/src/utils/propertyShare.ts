import type { PropertyDetail } from '@/types'

export interface ClientPropertySummaryOptions {
  isArabic?: boolean
}

function readable(value?: string | null): string {
  if (!value) return '—'
  return value.split('_').join(' ').toLowerCase().replace(/\b\w/g, (character: string) => character.toUpperCase())
}

function formatDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function money(amount: string | number, currency: string, isArabic: boolean): string {
  const code = currency?.trim().toUpperCase() || 'UNSPECIFIED'
  try {
    return new Intl.NumberFormat(isArabic ? 'ar-SA' : 'en-US', { style: 'currency', currency: code }).format(Number(amount))
  } catch {
    return `${amount} ${code}`
  }
}

function coordinate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(6) : null
}

/**
 * Builds a plain-text summary intended to be pasted to a client.
 *
 * Deliberately uses only listing fields: owner/agent records, deals, expenses,
 * commissions, payments, audit/property activity, operational notes and internal
 * notes are never read here.
 */
export function buildClientPropertySummary(property: PropertyDetail, options: ClientPropertySummaryOptions = {}): string {
  const isArabic = Boolean(options.isArabic)
  const t = (english: string, arabic: string) => isArabic ? arabic : english
  const images = [...(property.images || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const primaryImage = images.find((image) => image.isPrimary) || images[0] || null
  const address = [property.address, property.city, property.state, property.postalCode, property.country]
    .filter(Boolean)
    .join(', ')
  const latitude = coordinate(property.latitude)
  const longitude = coordinate(property.longitude)
  const area = property.area == null || property.area === ''
    ? '—'
    : `${property.area} ${property.areaUnit === 'SQ_FT' ? 'ft²' : 'm²'}`

  const lines: string[] = [
    t('PROPERTY SUMMARY', 'ملخص العقار'),
    `${t('Title', 'العنوان')}: ${property.title}`,
    `${t('Reference', 'الرقم المرجعي')}: ${property.referenceNumber}`,
    `${t('Price', 'السعر')}: ${money(property.price, property.currency, isArabic)}`,
    `${t('Status', 'الحالة')}: ${readable(property.status)}`,
    '',
    t('KEY SPECIFICATIONS', 'المواصفات الرئيسية'),
    `${t('Type', 'النوع')}: ${readable(property.type)}`,
    `${t('Classification', 'التصنيف')}: ${readable(property.classification)}`,
    `${t('Bedrooms', 'غرف النوم')}: ${property.bedrooms}`,
    `${t('Bathrooms', 'الحمامات')}: ${property.bathrooms}`,
    `${t('Area', 'المساحة')}: ${area}`,
    `${t('Year built', 'سنة البناء')}: ${property.yearBuilt ?? '—'}`,
    `${t('Condition', 'الحالة العامة')}: ${readable(property.condition)}`,
    `${t('Occupancy', 'الإشغال')}: ${property.occupancyStatus ? readable(property.occupancyStatus) : '—'}`,
    `${t('Available from', 'متاح من')}: ${formatDate(property.availableFrom)}`,
    `${t('Negotiable', 'قابل للتفاوض')}: ${property.negotiable ? t('Yes', 'نعم') : t('No', 'لا')}`,
    '',
    t('LOCATION', 'الموقع'),
    `${t('Address', 'العنوان')}: ${address || '—'}`,
    `${t('Coordinates', 'الإحداثيات')}: ${latitude && longitude ? `${latitude}, ${longitude}` : '—'}`,
    '',
    t('IMAGES', 'الصور'),
    `${t('Image count', 'عدد الصور')}: ${images.length}`,
    `${t('Primary image', 'الصورة الرئيسية')}: ${primaryImage?.originalName || (primaryImage ? t('Primary image on file', 'الصورة الرئيسية') : '—')}`
  ]

  // Description is client-facing marketing copy; operationalNotes and all
  // internal/deal/financial/audit fields are intentionally omitted.
  if (property.description?.trim()) {
    lines.push('', t('DESCRIPTION', 'الوصف'), property.description.trim())
  }

  return lines.join('\n')
}
