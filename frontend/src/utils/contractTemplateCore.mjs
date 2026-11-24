// Package 36: pure bilingual contract-template helpers. Kept framework-free so
// the Vue preview and the Node test suite exercise exactly the same logic.

export const CONTRACT_TOKENS = Object.freeze([
  'client_name',
  'property_title',
  'property_city',
  'property_area',
  'deal_reference',
  'deal_amount',
  'deal_currency',
  'agent_name',
  'organization_name',
  'today'
])

const TOKEN_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g

export function missingContractTokens(text) {
  if (typeof text !== 'string') return []
  const found = new Set()
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const token = match[1]
    if (!CONTRACT_TOKENS.includes(token)) found.add(token)
  }
  return [...found].sort()
}

export function renderContractText(text, values = {}) {
  if (typeof text !== 'string') return ''
  return text.replace(TOKEN_PATTERN, (_match, token) => {
    if (!CONTRACT_TOKENS.includes(token)) return '{{' + token + '}}'
    const value = values[token]
    return value === undefined || value === null || value === '' ? '—' : String(value)
  })
}

export function selectContractBody(template, language) {
  const source = template || {}
  if (language === 'ar') return source.bodyAr || source.body || ''
  return source.body || ''
}

export function buildContractPreview(template, values = {}, language = 'en') {
  const body = renderContractText(selectContractBody(template, language), values)
  const localizedTitle = language === 'ar'
    ? (template?.nameAr || template?.name || '')
    : (template?.name || '')

  return {
    title: localizedTitle,
    body,
    language: language === 'ar' ? 'ar' : 'en',
    direction: language === 'ar' ? 'rtl' : 'ltr',
    missingTokens: missingContractTokens(body),
    hasArabicBody: Boolean(template?.bodyAr)
  }
}

export function contractValueContext({ deal, property, lead, user, organization, today } = {}) {
  const client = [lead?.firstName, lead?.lastName].filter(Boolean).join(' ').trim()
  return {
    client_name: client || '—',
    property_title: property?.title || '—',
    property_city: property?.city || '—',
    property_area: property?.area == null ? '—' : String(property.area),
    deal_reference: deal?.referenceNumber || deal?.id || '—',
    deal_amount: deal?.amount == null ? '—' : String(deal.amount),
    deal_currency: deal?.currency || '—',
    agent_name: [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.email || '—',
    organization_name: organization?.name || 'EstateOS',
    today: today || new Date().toISOString().slice(0, 10)
  }
}
