/**
 * EstateOS Package 26 — pure bilingual WhatsApp template engine.
 *
 * ESM JavaScript core shared by the TypeScript frontend helper and the Node
 * test suite. It uses no DOM, Vue, Axios or Node APIs and includes only public
 * listing data in messages (never owner notes, internal notes or credentials).
 */

/** @typedef {'en' | 'ar'} WhatsAppLanguage */
/** @typedef {'propertyShare' | 'appointmentConfirmation' | 'appointmentReminder' | 'installmentReminder'} WhatsAppTemplateKey */

/** @param {WhatsAppLanguage} language @param {string} english @param {string} arabic */
function t(language, english, arabic) {
  return language === 'ar' ? arabic : english
}

/** @param {unknown} value */
function text(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/** @param {unknown} value @param {WhatsAppLanguage} language */
function formatDate(value, language) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return text(value)
  try {
    // Latin digits stay legible to Arabic-speaking clients on WhatsApp.
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

/** @param {unknown} value @param {unknown} currency */
function money(value, currency) {
  const amount = text(value)
  const code = text(currency).toUpperCase()
  if (!amount) return ''
  return code ? `${amount} ${code}` : amount
}

/** @param {Record<string, unknown>} payload @param {WhatsAppLanguage} language */
function areaLabel(payload, language) {
  const area = text(payload.area)
  if (!area) return ''
  const unit = text(payload.areaUnit).toUpperCase() === 'SQ_FT'
    ? t(language, 'sq ft', 'قدم²')
    : t(language, 'm²', 'م²')
  return `${area} ${unit}`
}

/** @param {Record<string, unknown>} payload */
function publicLink(payload) {
  const explicit = text(payload.link)
  if (explicit) return explicit
  const token = text(payload.token)
  if (!token) return ''
  const origin = text(payload.origin).replace(/\/$/, '')
  return `${origin}/p/${encodeURIComponent(token)}`
}

/** @param {Record<string, unknown>} payload @param {WhatsAppLanguage} language */
function specsLine(payload, language) {
  const parts = []
  const bedrooms = text(payload.bedrooms)
  const bathrooms = text(payload.bathrooms)
  if (bedrooms) parts.push(`${bedrooms} ${t(language, 'bed', 'غرفة')}`)
  if (bathrooms) parts.push(`${bathrooms} ${t(language, 'bath', 'حمام')}`)
  const area = areaLabel(payload, language)
  if (area) parts.push(area)
  return parts.join(' · ')
}

/**
 * @param {WhatsAppTemplateKey} key
 * @param {Record<string, unknown>} payload
 * @param {WhatsAppLanguage} language
 */
function defaultTemplate(key, payload, language) {
  const lines = []

  if (key === 'propertyShare') {
    lines.push(t(language, '🏡 Property for you', '🏡 عقار مناسب لك'))
    const heading = [text(payload.title), text(payload.reference)].filter(Boolean).join(' — ')
    if (heading) lines.push(heading)
    const location = [text(payload.address), text(payload.city)].filter(Boolean).join(', ')
    if (location) lines.push(`📍 ${location}`)
    const specs = specsLine(payload, language)
    if (specs) lines.push(`📐 ${specs}`)
    const price = money(payload.price, payload.currency)
    if (price) lines.push(`💰 ${t(language, 'Price', 'السعر')}: ${price}`)
    const link = publicLink(payload)
    if (link) lines.push(`🔗 ${t(language, 'Details', 'التفاصيل')}: ${link}`)
  }

  if (key === 'appointmentConfirmation' || key === 'appointmentReminder') {
    const confirmed = key === 'appointmentConfirmation'
    lines.push(confirmed
      ? t(language, '✅ Appointment confirmed', '✅ تم تأكيد الموعد')
      : t(language, '⏰ Appointment reminder', '⏰ تذكير بالموعد'))
    const customer = text(payload.customerName)
    if (customer) lines.push(`${t(language, 'Dear', 'عزيزي')} ${customer},`)
    const when = formatDate(payload.startsAt, language)
    if (when) lines.push(`🗓 ${t(language, 'When', 'الموعد')}: ${when}`)
    const property = text(payload.title)
    if (property) lines.push(`🏡 ${t(language, 'Property', 'العقار')}: ${property}`)
    const location = text(payload.location)
    if (location) lines.push(`📍 ${t(language, 'Location', 'المكان')}: ${location}`)
    const link = publicLink(payload)
    if (link) lines.push(`🔗 ${t(language, 'Details', 'التفاصيل')}: ${link}`)
  }

  if (key === 'leadFollowUp') {
    lines.push(t(language, '👋 Following up on your enquiry', '👋 متابعة طلبك'))
    const customer = text(payload.customerName)
    if (customer) lines.push(`${t(language, 'Dear', 'عزيزي')} ${customer},`)
    lines.push(t(
      language,
      'Thank you for your interest. Please let us know if you would like to arrange a viewing or receive more details.',
      'شكراً لاهتمامك. أخبرنا إذا كنت ترغب في حجز معاينة أو الحصول على مزيد من التفاصيل.'
    ))
    const property = text(payload.title)
    if (property) lines.push(`🏡 ${t(language, 'Property', 'العقار')}: ${property}`)
    const link = publicLink(payload)
    if (link) lines.push(`🔗 ${t(language, 'Details', 'التفاصيل')}: ${link}`)
  }

  if (key === 'installmentReminder') {
    lines.push(t(language, '💳 Installment payment reminder', '💳 تذكير بدفعة قسط'))
    const customer = text(payload.customerName)
    if (customer) lines.push(`${t(language, 'Dear', 'عزيزي')} ${customer},`)
    const reference = [text(payload.reference), text(payload.title)].filter(Boolean).join(' — ')
    if (reference) lines.push(reference)
    const due = formatDate(payload.dueDate, language)
    if (due) lines.push(`🗓 ${t(language, 'Due date', 'تاريخ الاستحقاق')}: ${due}`)
    const amount = money(payload.amount, payload.currency)
    if (amount) lines.push(`💰 ${t(language, 'Installment', 'القسط')}: ${amount}`)
    const balance = money(payload.remainingBalance, payload.currency)
    if (balance) lines.push(`🧾 ${t(language, 'Remaining balance', 'الرصيد المتبقي')}: ${balance}`)
  }

  return lines.filter(Boolean).join('\n')
}

/**
 * Replace `{{field}}` placeholders with payload values; unknown fields become empty.
 * @param {string} template
 * @param {Record<string, unknown>} payload
 */
export function renderWhatsAppTemplate(template, payload = {}) {
  const values = payload
  const rendered = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
    const value = String(key).split('.').reduce((current, part) => {
      if (!current || typeof current !== 'object') return undefined
      return current[part]
    }, values)
    return text(value)
  })
  return rendered.split('\n').map((line) => line.trimEnd()).join('\n').replace(/^\n+|\n+$/g, '')
}

/**
 * @param {WhatsAppTemplateKey} key
 * @param {Record<string, unknown>} payload
 * @param {WhatsAppLanguage} language
 * @param {Partial<Record<WhatsAppTemplateKey, string>>} overrides
 */
export function buildWhatsAppTemplate(key, payload, language = 'en', overrides) {
  const override = overrides?.[key]
  const body = override && override.trim()
    ? renderWhatsAppTemplate(override, payload)
    : defaultTemplate(key, payload, language)
  return { language, template: key, text: body }
}

/**
 * Normalize Egyptian local/international numbers to E.164 digits (no '+').
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeWhatsAppPhone(raw) {
  const original = text(raw)
  if (!original) return null
  let digits = original.replace(/[^\d]/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0') && digits.length >= 10) digits = `20${digits.slice(1)}`
  // "+20 010..." is a common way to write an Egyptian mobile with an extra 0.
  if (digits.startsWith('20') && digits[2] === '0') digits = `${digits.slice(0, 2)}${digits.slice(3)}`
  if (!/^\d{9,15}$/.test(digits)) return null
  if (/^(\d)\1+$/.test(digits)) return null
  return digits
}

/**
 * @param {unknown} phone
 * @param {string} message
 * @returns {string | null}
 */
export function buildWhatsAppUrl(phone, message) {
  const normalized = normalizeWhatsAppPhone(phone)
  if (!normalized || !text(message)) return null
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`
}

/**
 * @param {{ phone: unknown, template: WhatsAppTemplateKey, payload?: Record<string, unknown>, language?: WhatsAppLanguage, overrides?: Partial<Record<WhatsAppTemplateKey, string>> }} options
 */
export function buildWhatsAppMessageLink(options) {
  const rendered = buildWhatsAppTemplate(options.template, options.payload || {}, options.language || 'en', options.overrides)
  return buildWhatsAppUrl(options.phone, rendered.text)
}

/** @param {string} token @param {string | null | undefined} origin */
export function propertySharePath(token, origin) {
  return `${text(origin).replace(/\/$/, '')}/p/${encodeURIComponent(text(token))}`
}
