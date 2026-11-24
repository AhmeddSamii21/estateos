export const NOTIFICATION_CATEGORIES = [
  'PROPERTY',
  'LEAD',
  'DEAL',
  'APPOINTMENT',
  'MAINTENANCE',
  'FINANCE',
  'SYSTEM'
] as const

export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number]

const FINANCE_PREFIXES = /^(PAYMENT|COMMISSION|EXPENSE|CURRENCY|EXCHANGE|FX)_/

export function notificationCategoryOf(type: string | null | undefined): NotificationCategory {
  const value = (type ?? '').toUpperCase()
  if (value.startsWith('PROPERTY_')) return 'PROPERTY'
  if (value.startsWith('LEAD_')) return 'LEAD'
  if (value.startsWith('DEAL_')) return 'DEAL'
  if (value.startsWith('APPOINTMENT_')) return 'APPOINTMENT'
  if (value.startsWith('MAINTENANCE_')) return 'MAINTENANCE'
  if (FINANCE_PREFIXES.test(value)) return 'FINANCE'
  return 'SYSTEM'
}

export function notificationTypeMatchesCategory(type: string | null | undefined, category: string): boolean {
  const normalized = category.toUpperCase()
  if (normalized === 'ALL') return true
  const actual = notificationCategoryOf(type)
  if (normalized === 'SYSTEM') return actual === 'SYSTEM'
  return NOTIFICATION_CATEGORIES.some((item) => item === normalized) && actual === normalized
}

const SAFE_STATIC_URLS = new Set([
  '/leads',
  '/appointments',
  '/finance/commission-statements'
])

// Reminder links already emitted by the backend; keeping them in the allowlist
// preserves deep links while blocking every other user-supplied URL.
const SAFE_LEAD_QUERY_URLS = new Set([
  '/leads?followUp=overdue',
  '/leads?followUp=today',
  '/leads?followUp=upcoming'
])

const CATEGORY_PREFIXES: Record<NotificationCategory, readonly string[]> = {
  PROPERTY: ['PROPERTY_'],
  LEAD: ['LEAD_'],
  DEAL: ['DEAL_'],
  APPOINTMENT: ['APPOINTMENT_'],
  MAINTENANCE: ['MAINTENANCE_'],
  FINANCE: ['PAYMENT_', 'COMMISSION_', 'EXPENSE_', 'CURRENCY_', 'EXCHANGE_', 'FX_'],
  SYSTEM: []
}

/** Category filters are pushed into SQL so list endpoints never read all rows. */
export function notificationCategoryTypeFilter(category: string): Record<string, unknown> {
  const normalized = category.toUpperCase()
  if (normalized === 'ALL' || !NOTIFICATION_CATEGORIES.some((item) => item === normalized)) return {}
  if (normalized === 'SYSTEM') {
    const prefixes = NOTIFICATION_CATEGORIES
      .filter((item) => item !== 'SYSTEM')
      .flatMap((item) => CATEGORY_PREFIXES[item])
      .map((prefix) => ({ NOT: { type: { startsWith: prefix } } }))
    return { AND: prefixes }
  }
  return { OR: CATEGORY_PREFIXES[normalized as NotificationCategory].map((prefix) => ({ type: { startsWith: prefix } })) }
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/

export function resolveNotificationTarget(input: {
  entityType?: string | null
  entityId?: string | null
  actionUrl?: string | null
}): string | null {
  const actionUrl = typeof input.actionUrl === 'string' ? input.actionUrl.trim() : ''
  if (actionUrl) {
    if (SAFE_STATIC_URLS.has(actionUrl) || SAFE_LEAD_QUERY_URLS.has(actionUrl)) return actionUrl
    if (/^\/properties\/[A-Za-z0-9_-]+$/.test(actionUrl)) return actionUrl
    if (/^\/deals\/[A-Za-z0-9_-]+$/.test(actionUrl)) return actionUrl
  }

  const entityType = typeof input.entityType === 'string' ? input.entityType.trim().toUpperCase() : ''
  const entityId = typeof input.entityId === 'string' ? input.entityId.trim() : ''
  const pathWithId = (path: string) => ID_PATTERN.test(entityId) ? `${path}/${entityId}` : null

  switch (entityType) {
    case 'PROPERTY':
      return pathWithId('/properties')
    case 'DEAL':
      return pathWithId('/deals')
    case 'LEAD':
      return '/leads'
    case 'APPOINTMENT':
      return '/appointments'
    case 'COMMISSION':
    case 'PAYMENT':
      return '/finance/commission-statements'
    default:
      return null
  }
}
