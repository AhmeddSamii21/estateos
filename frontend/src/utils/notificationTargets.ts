export const NOTIFICATION_CATEGORIES = [
  'PROPERTY',
  'LEAD',
  'DEAL',
  'APPOINTMENT',
  'MAINTENANCE',
  'FINANCE',
  'SYSTEM'
] as const

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

const FINANCE_PREFIXES = ['PAYMENT_', 'COMMISSION_', 'EXPENSE_', 'CURRENCY_', 'EXCHANGE_', 'FX_']
const CATEGORY_PREFIXES: Array<[string, NotificationCategory]> = [
  ['PROPERTY_', 'PROPERTY'],
  ['LEAD_', 'LEAD'],
  ['DEAL_', 'DEAL'],
  ['APPOINTMENT_', 'APPOINTMENT'],
  ['MAINTENANCE_', 'MAINTENANCE']
]

export function notificationCategoryOf(type: string | null | undefined): NotificationCategory {
  const value = (type || '').toUpperCase()
  for (const [prefix, category] of CATEGORY_PREFIXES) {
    if (value.startsWith(prefix)) return category
  }
  if (FINANCE_PREFIXES.some((prefix) => value.startsWith(prefix))) return 'FINANCE'
  return 'SYSTEM'
}

const COLLECTION_TARGETS = new Set(['/leads', '/appointments', '/finance/commission-statements'])
const ID_PATTERN = /^[A-Za-z0-9_-]+$/

function validatePath(path: string): string | null {
  const clean = path.trim().replace(/\/+$/, '')
  if (!clean.startsWith('/') || /[?#]/.test(clean)) return null
  if (COLLECTION_TARGETS.has(clean)) return clean
  const match = /^\/(properties|deals)\/([^/]+)$/.exec(clean)
  if (match && ID_PATTERN.test(match[2])) return `/${match[1]}/${match[2]}`
  return null
}

function pathFromHint(value: string | null | undefined): string | null {
  if (!value) return null
  const raw = value.trim()
  // Only root-relative paths are considered; absolute/external URLs are ignored.
  if (!raw.startsWith('/') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
  return validatePath(raw)
}

function pathFromEntity(entityType: string | null | undefined, entityId: string | null | undefined): string | null {
  const type = (entityType || '').toUpperCase().replace(/[\s-]/g, '_')
  const id = entityId?.trim() || ''
  if (id && !ID_PATTERN.test(id)) return null

  if ((type === 'PROPERTY' || type.startsWith('PROPERTY_')) && id) return `/properties/${id}`
  if ((type === 'DEAL' || type.startsWith('DEAL_')) && id) return `/deals/${id}`
  if (type === 'LEAD' || type.startsWith('LEAD_')) return '/leads'
  if (type === 'APPOINTMENT' || type.startsWith('APPOINTMENT_')) return '/appointments'
  if (['COMMISSION', 'COMMISSION_STATEMENT', 'COMMISSIONSTATEMENT', 'EXPENSE', 'PAYMENT'].includes(type)) {
    return '/finance/commission-statements'
  }
  return null
}

/** Never returns caller-supplied URLs unless they reduce to a strict allowlisted path. */
export function resolveNotificationTarget(input: {
  entityType?: string | null
  entityId?: string | null
  actionUrl?: string | null
  targetUrl?: string | null
}): string | null {
  return pathFromHint(input.targetUrl)
    ?? pathFromHint(input.actionUrl)
    ?? pathFromEntity(input.entityType, input.entityId)
}
