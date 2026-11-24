/**
 * EstateOS Package 34 — pure, dependency-free property comparison helpers.
 *
 * The module is intentionally ESM with no Vue/Prisma imports so the same code
 * powers the bilingual comparison drawer and the Node test runner.
 */

export const COMPARE_METRIC_KEYS = [
  'price',
  'pricePerSqm',
  'area',
  'rooms',
  'location',
  'paymentTerms',
  'coverPhoto',
  'features'
]

export const COMPARE_MIN = 2
export const COMPARE_MAX = 4

const LABELS = {
  en: {
    price: 'Price',
    pricePerSqm: 'Price / sqm',
    area: 'Area',
    rooms: 'Beds / baths',
    location: 'Location',
    paymentTerms: 'Payment terms',
    coverPhoto: 'Cover photo',
    features: 'Features'
  },
  ar: {
    price: 'السعر',
    pricePerSqm: 'السعر / المتر',
    area: 'المساحة',
    rooms: 'غرف النوم / الحمامات',
    location: 'الموقع',
    paymentTerms: 'شروط الدفع',
    coverPhoto: 'صورة الغلاف',
    features: 'المميزات'
  }
}

function languageOf(language) {
  return language === 'ar' ? 'ar' : 'en'
}

function label(key, language) {
  const normalized = languageOf(language)
  return LABELS[normalized][key] || key
}

function text(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function number(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function money(value, currency) {
  const amount = number(value)
  if (amount === null) return '—'
  const code = text(currency).toUpperCase()
  const formatted = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return code ? `${formatted} ${code}` : formatted
}

/** Price per square metre is derived so historical properties need no rewrite. */
export function pricePerSqm(property) {
  const price = number(property?.price)
  const area = number(property?.area)
  if (price === null || area === null || area <= 0) return null
  return price / area
}

function coverPhotoUrl(property) {
  const images = Array.isArray(property?.images) ? property.images : []
  const primary = images.find((image) => image && image.isPrimary && text(image.url))
  const first = images.find((image) => image && text(image.url))
  return text((primary || first)?.url) || null
}

function areaValue(property, language) {
  const area = number(property?.area)
  if (area === null) return '—'
  const unit = text(property?.areaUnit).toUpperCase() === 'SQ_FT'
    ? (language === 'ar' ? 'قدم²' : 'sq ft')
    : (language === 'ar' ? 'م²' : 'sqm')
  return `${area.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unit}`
}

function locationValue(property) {
  return [property?.city, property?.state, property?.country, property?.address, property?.projectName, property?.buildingName]
    .map(text)
    .filter(Boolean)
    .slice(0, 3)
    .join(', ') || '—'
}

function paymentTermsValue(property, language) {
  const custom = text(property?.paymentTerms)
  if (custom) return custom
  if (property?.negotiable === true) return language === 'ar' ? 'قابل للتفاوض' : 'Negotiable'
  return '—'
}

/** Returns a stable list of 2–4 comparable ids, or throws a localized error. */
export function validateCompareSelection(ids) {
  if (!Array.isArray(ids)) throw new Error('Select between 2 and 4 properties')
  const unique = Array.from(new Set(ids.filter((id) => text(id)).map((id) => text(id))))
  if (unique.length < COMPARE_MIN || unique.length > COMPARE_MAX) {
    throw new Error('Select between 2 and 4 properties')
  }
  return unique
}

/** One row per compared metric; `values` follows the property order. */
export function buildCompareRows(properties, language = 'en') {
  const selected = Array.isArray(properties) ? properties : []
  const normalized = languageOf(language)
  const values = {
    price: (property) => money(property?.price, property?.currency),
    pricePerSqm: (property) => {
      const rate = pricePerSqm(property)
      return rate === null ? '—' : money(rate.toFixed(2), property?.currency)
    },
    area: (property) => areaValue(property, normalized),
    rooms: (property) => `${number(property?.bedrooms) ?? 0} / ${number(property?.bathrooms) ?? 0}`,
    location: locationValue,
    paymentTerms: (property) => paymentTermsValue(property, normalized),
    coverPhoto: (property) => coverPhotoUrl(property) || (normalized === 'ar' ? 'لا توجد صورة' : 'No photo'),
    features: (property) => text(property?.features) || (normalized === 'ar' ? '—' : '—')
  }
  return COMPARE_METRIC_KEYS.map((key) => ({
    key,
    label: label(key, normalized),
    values: selected.map((property) => values[key](property))
  }))
}

export function buildCompareSummary(properties, language = 'en') {
  const selected = Array.isArray(properties) ? properties : []
  const normalized = languageOf(language)
  const rows = buildCompareRows(selected, normalized)
  const heading = normalized === 'ar' ? 'مقارنة العقارات — إستيت أو إس' : 'EstateOS property comparison'
  const lines = [heading, '']
  selected.forEach((property, index) => {
    const title = text(property?.title) || (normalized === 'ar' ? `عقار ${index + 1}` : `Property ${index + 1}`)
    lines.push(`${index + 1}. ${title} — ${text(property?.referenceNumber) || '—'}`)
  })
  lines.push('')
  for (const row of rows) {
    lines.push(`${row.label}: ${row.values.join('  |  ')}`)
  }
  return lines.join('\n').trim()
}

export function buildCompareWhatsAppMessage(properties, language = 'en') {
  return buildCompareSummary(properties, language)
}
