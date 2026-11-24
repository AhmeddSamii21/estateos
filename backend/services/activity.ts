import { Prisma, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { createError } from '../middleware/errorHandler'
import { FINANCE_ROLES, leadScope, ownerReadScope } from '../utils/scope'
import { appointmentScope } from '../utils/appointments'

/**
 * Activity timeline data access.
 *
 * AuditLog is the single persisted source. It deliberately has no organization
 * column, so organization isolation is enforced twice:
 *   1. the actor must belong to the viewer's organization, and
 *   2. the referenced business record must be accessible under the same rules
 *      used by that entity's own API (including Agent restrictions).
 *
 * PropertyActivity is left to the existing property detail endpoint; every
 * property event is also written to AuditLog, so merging both would duplicate
 * the same business event.
 */

export const ACTIVITY_ENTITY_TYPES = [
  'Property',
  'Owner',
  'Lead',
  'Deal',
  'Payment',
  'Expense',
  'Appointment',
  'MaintenanceRequest',
  'Document',
  'Commission'
] as const

export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number]
export type ActivityViewer = { id: string; role: Role; organizationId: string }

const FINANCE_ENTITY_TYPES: ActivityEntityType[] = ['Payment', 'Expense', 'Commission']

export interface ActivityEntityInfo {
  id: string
  label: string
  meta: Record<string, string | number | boolean | null>
  href: string | null
}

export interface ActivityChange {
  field: string
  before?: unknown
  after?: unknown
  changed?: boolean
}

export interface ActivityChangeSet {
  metadata: Record<string, unknown>
  changes: ActivityChange[]
}

const SENSITIVE_KEY = /pass(word|phrase)|secret|token|credential|api[-_]?key|authorization|storage[-_]?key|storagekey|file[-_]?path|filepath|idempotency|session|cookie|signature/i

function cleanValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value
  if (Array.isArray(value)) {
    if (depth >= 4) return '[truncated]'
    return value.slice(0, 40).map((entry) => cleanValue(entry, depth + 1))
  }
  if (typeof value === 'object') {
    if (depth >= 4) return '[truncated]'
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 60)) {
      if (SENSITIVE_KEY.test(key)) continue
      result[key.slice(0, 100)] = cleanValue(entry, depth + 1)
    }
    return result
  }
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Parses stored audit details without trusting their shape. Unknown keys are
 * kept as metadata unless they look like credentials or internal file paths;
 * previous/new values are only returned when the record actually contains them.
 */
export function sanitizeActivityDetails(raw: string | null | undefined): ActivityChangeSet {
  const empty: ActivityChangeSet = { metadata: {}, changes: [] }
  if (!raw) return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return empty
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty

  const source = parsed as Record<string, unknown>
  const changes: ActivityChange[] = []
  const seenFields = new Set<string>()
  const metadata: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(source)) {
    if (SENSITIVE_KEY.test(key)) continue
    if (key === 'before' || key === 'after') {
      // Top-level scalar transitions are handled after the loop.
      continue
    }
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      ('before' in value || 'after' in value)
    ) {
      if (!seenFields.has(key)) {
        seenFields.add(key)
        const change: ActivityChange = { field: key }
        const pair = value as Record<string, unknown>
        if ('before' in pair) change.before = cleanValue(pair.before, 0)
        if ('after' in pair) change.after = cleanValue(pair.after, 0)
        changes.push(change)
      }
      continue
    }
    if (key === 'fields' && Array.isArray(value)) {
      // A field list without values must never be presented as before/after data.
      metadata.fields = cleanValue(value, 0)
      for (const field of value.slice(0, 40)) {
        if (typeof field === 'string' && !seenFields.has(field)) {
          seenFields.add(field)
          changes.push({ field, changed: true })
        }
      }
      continue
    }
    metadata[key] = cleanValue(value, 0)
  }

  const before = source.before
  const after = source.after
  if ('before' in source || 'after' in source) {
    // Top-level pairs are used by several modules for different fields. Never
    // guess that they mean "status": use an explicit hint when present, expand
    // object pairs into their real keys, and otherwise use a neutral label.
    const hint = typeof source.field === 'string' ? source.field : undefined
    if (hint && !SENSITIVE_KEY.test(hint) && !seenFields.has(hint)) {
      seenFields.add(hint)
      const change: ActivityChange = { field: hint.slice(0, 100) }
      if (before !== undefined) change.before = cleanValue(before, 0)
      if (after !== undefined) change.after = cleanValue(after, 0)
      changes.push(change)
    } else if (isPlainObject(before) && isPlainObject(after)) {
      const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
        .filter((key) => !SENSITIVE_KEY.test(key))
        .slice(0, 40)
      for (const key of keys) {
        if (seenFields.has(key)) continue
        seenFields.add(key)
        changes.push({
          field: key.slice(0, 100),
          ...(key in before ? { before: cleanValue(before[key], 0) } : {}),
          ...(key in after ? { after: cleanValue(after[key], 0) } : {})
        })
      }
    } else {
      const field = 'value'
      if (!seenFields.has(field)) {
        seenFields.add(field)
        const change: ActivityChange = { field }
        if (before !== undefined) change.before = cleanValue(before, 0)
        if (after !== undefined) change.after = cleanValue(after, 0)
        changes.push(change)
      }
    }
  }

  return { metadata, changes }
}

function isFinanceType(type: ActivityEntityType): boolean {
  return FINANCE_ENTITY_TYPES.includes(type)
}

export function allowedEntityTypes(viewer: ActivityViewer): ActivityEntityType[] {
  return isAgent(viewer)
    ? ACTIVITY_ENTITY_TYPES.filter((type) => !isFinanceType(type))
    : [...ACTIVITY_ENTITY_TYPES]
}

function isAgent(viewer: ActivityViewer): boolean {
  return viewer.role === Role.AGENT
}

function isFinanceRole(viewer: ActivityViewer): boolean {
  return FINANCE_ROLES.includes(viewer.role)
}

function labelOf(parts: Array<string | null | undefined>, fallback: string): string {
  return parts.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' ').trim() || fallback
}

/**
 * Loads a batch of entity records that this viewer may read, together with
 * safe display fields. One query per entity type is used (never one per event).
 */
export async function loadAccessibleEntities(
  type: ActivityEntityType,
  ids: string[],
  viewer: ActivityViewer
): Promise<ActivityEntityInfo[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean))).slice(0, 200)
  if (!uniqueIds.length) return []
  const org = viewer.organizationId
  const agentId = viewer.id

  switch (type) {
    case 'Property': {
      const rows = await prisma.property.findMany({
        where: {
          id: { in: uniqueIds },
          organizationId: org,
          ...(isAgent(viewer) ? { assignedAgentId: agentId } : {})
        },
        take: 200,
        select: { id: true, referenceNumber: true, title: true, status: true, deletedAt: true }
      })
      return rows.map((row) => ({
        id: row.id,
        label: row.title || row.referenceNumber,
        meta: { referenceNumber: row.referenceNumber, status: row.status, archived: row.deletedAt !== null },
        // Keep history visible, but never link to an archived record that the
        // underlying detail API intentionally hides.
        href: row.deletedAt ? null : `/properties/${row.id}`
      }))
    }
    case 'Owner': {
      const rows = await prisma.owner.findMany({
        where: {
          id: { in: uniqueIds },
          ...ownerReadScope(org)
        },
        take: 200,
        select: { id: true, firstName: true, lastName: true, companyName: true, isActive: true, deletedAt: true }
      })
      return rows.map((row) => ({
        id: row.id,
        label: labelOf([row.companyName, row.firstName, row.lastName], 'Owner'),
        meta: { isActive: row.isActive, archived: row.deletedAt !== null || !row.isActive },
        // Owners are edited in a table modal; there is no owner detail route.
        href: null
      }))
    }
    case 'Lead': {
      const rows = await prisma.lead.findMany({
        where: {
          id: { in: uniqueIds },
          ...leadScope(org)
        },
        take: 200,
        select: { id: true, firstName: true, lastName: true, status: true, deletedAt: true }
      })
      return rows.map((row) => ({
        id: row.id,
        label: labelOf([row.firstName, row.lastName], 'Lead'),
        meta: { status: row.status, archived: row.deletedAt !== null },
        // Leads currently have no detail route in the UI.
        href: null
      }))
    }
    case 'Deal': {
      const rows = await prisma.deal.findMany({
        where: {
          id: { in: uniqueIds },
          organizationId: org,
          ...(!canViewAllDeals(viewer) ? { userId: agentId } : {})
        },
        take: 200,
        select: { id: true, referenceNumber: true, status: true, deletedAt: true }
      })
      return rows.map((row) => ({
        id: row.id,
        label: row.referenceNumber || 'Deal',
        meta: { status: row.status, archived: row.deletedAt !== null },
        href: row.deletedAt ? null : `/deals/${row.id}`
      }))
    }
    case 'Payment': {
      if (!isFinanceRole(viewer)) return []
      const rows = await prisma.payment.findMany({
        where: { id: { in: uniqueIds }, deal: { organizationId: org } },
        take: 200,
        select: { id: true, reference: true, status: true, currency: true, deletedAt: true, deal: { select: { referenceNumber: true } } }
      })
      return rows.map((row) => ({
        id: row.id,
        label: row.reference || row.deal.referenceNumber || 'Payment',
        meta: { status: row.status, currency: row.currency, archived: row.deletedAt !== null },
        href: '/finance/payments'
      }))
    }
    case 'Expense': {
      if (!isFinanceRole(viewer)) return []
      const rows = await prisma.expense.findMany({
        where: {
          id: { in: uniqueIds },
          AND: [
            { OR: [{ property: { organizationId: org } }, { deal: { organizationId: org } }, { responsible: { organizationId: org } }] },
            { OR: [{ propertyId: null }, { property: { organizationId: org } }] },
            { OR: [{ dealId: null }, { deal: { organizationId: org } }] },
            { OR: [{ responsibleId: null }, { responsible: { organizationId: org } }] }
          ]
        },
        take: 200,
        select: { id: true, category: true, status: true, currency: true, deletedAt: true }
      })
      return rows.map((row) => ({
        id: row.id,
        label: row.category || 'Expense',
        meta: { status: row.status, currency: row.currency, archived: row.deletedAt !== null },
        href: '/finance/expenses'
      }))
    }
    case 'Appointment': {
      const rows = await prisma.appointment.findMany({
        where: {
          id: { in: uniqueIds },
          ...appointmentScope(org)
        },
        take: 200,
        select: { id: true, title: true, type: true, status: true, startsAt: true }
      })
      return rows.map((row) => ({
        id: row.id,
        label: row.title || row.type,
        meta: { status: row.status, startsAt: row.startsAt.toISOString() },
        href: '/appointments'
      }))
    }
    case 'MaintenanceRequest': {
      const rows = await prisma.maintenanceRequest.findMany({
        where: {
          id: { in: uniqueIds },
          organizationId: org,
          ...(isAgent(viewer) ? { assignedToId: agentId } : {})
        },
        take: 200,
        select: { id: true, title: true, status: true, priority: true, deletedAt: true }
      })
      return rows.map((row) => ({
        id: row.id,
        label: row.title || 'Maintenance request',
        meta: { status: row.status, priority: row.priority, archived: row.deletedAt !== null },
        href: row.deletedAt ? null : '/maintenance'
      }))
    }
    case 'Document': {
      const rows = await prisma.document.findMany({
        where: {
          id: { in: uniqueIds },
          organizationId: org,
          deletedAt: null,
          ...(isAgent(viewer)
            ? {
                OR: [
                  { uploadedById: agentId },
                  { property: { assignedAgentId: agentId } },
                  { deal: { userId: agentId } },
                  { lead: { assignedToId: agentId } }
                ]
              }
            : {})
        },
        take: 200,
        select: { id: true, name: true, category: true, status: true }
      })
      return rows.map((row) => ({
        id: row.id,
        label: row.name || 'Document',
        meta: { category: row.category, status: row.status },
        href: '/documents'
      }))
    }
    case 'Commission': {
      if (!isFinanceRole(viewer)) return []
      const rows = await prisma.commission.findMany({
        where: { id: { in: uniqueIds }, deal: { organizationId: org } },
        take: 200,
        select: { id: true, status: true, currency: true, deletedAt: true, deal: { select: { referenceNumber: true } } }
      })
      return rows.map((row) => ({
        id: row.id,
        label: row.deal.referenceNumber || 'Commission',
        meta: { status: row.status, currency: row.currency, archived: row.deletedAt !== null },
        href: '/finance/commissions'
      }))
    }
  }
}

function canViewAllDeals(viewer: ActivityViewer): boolean {
  return viewer.role === Role.ADMIN || viewer.role === Role.MANAGER || viewer.role === Role.ACCOUNTANT
}

type AuditLogWithUser = Prisma.AuditLogGetPayload<{
  include: { user: { select: { id: true; email: true; firstName: true; role: true } } }
}>

export interface ActivityEntry {
  id: string
  action: string
  entityType: ActivityEntityType
  entityId: string
  timestamp: string
  actor: { id: string; email: string; firstName: string | null; role: Role } | null
  entity: ActivityEntityInfo
  metadata: Record<string, unknown>
  changes: ActivityChange[]
}

function toEntry(log: AuditLogWithUser, entity: ActivityEntityInfo): ActivityEntry {
  const details = sanitizeActivityDetails(log.details)
  return {
    id: log.id,
    action: log.action,
    entityType: log.entityType as ActivityEntityType,
    entityId: log.entityId as string,
    timestamp: log.createdAt.toISOString(),
    actor: log.user
      ? { id: log.user.id, email: log.user.email, firstName: log.user.firstName, role: log.user.role }
      : null,
    entity,
    metadata: details.metadata,
    changes: details.changes
  }
}

const auditInclude = {
  user: { select: { id: true, email: true, firstName: true, role: true } }
} as const

export interface ActivityFilters {
  entityType?: ActivityEntityType
  action?: string
  userId?: string
  from?: Date
  to?: Date
}

function baseWhere(viewer: ActivityViewer, filters: ActivityFilters): Prisma.AuditLogWhereInput[] {
  const conditions: Prisma.AuditLogWhereInput[] = [
    // Actor organization: no cross-organization audit rows can enter a page.
    { user: { organizationId: viewer.organizationId } },
    { entityType: { in: [...allowedEntityTypes(viewer)] } },
    { entityId: { not: null } }
  ]
  if (filters.entityType) conditions.push({ entityType: filters.entityType })
  if (filters.action) conditions.push({ action: filters.action })
  if (filters.userId) conditions.push({ userId: filters.userId })
  if (filters.from || filters.to) {
    conditions.push({
      createdAt: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {})
      }
    })
  }
  return conditions
}

export function encodeCursor(timestamp: Date, id: string): string {
  return Buffer.from(JSON.stringify({ timestamp: timestamp.toISOString(), id })).toString('base64url')
}

export function decodeCursor(value: string): { timestamp: Date; id: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw createError('Invalid cursor', 400)
  }
  if (
    !parsed || typeof parsed !== 'object' ||
    typeof (parsed as { timestamp?: unknown }).timestamp !== 'string' ||
    typeof (parsed as { id?: unknown }).id !== 'string'
  ) {
    throw createError('Invalid cursor', 400)
  }
  const timestamp = new Date((parsed as { timestamp: string }).timestamp)
  const id = (parsed as { id: string }).id
  if (Number.isNaN(timestamp.getTime()) || id.length < 1 || id.length > 200) {
    throw createError('Invalid cursor', 400)
  }
  return { timestamp, id }
}

function afterCursor(timestamp: Date, id: string): Prisma.AuditLogWhereInput {
  return {
    OR: [
      { createdAt: { lt: timestamp } },
      { createdAt: timestamp, id: { lt: id } }
    ]
  }
}

/**
 * Global timeline. Candidates are read in bounded batches and filtered through
 * entity-level access checks; a cursor keeps pagination correct when a batch
 * contains records the viewer may not see.
 */
export async function listGlobalActivity(
  viewer: ActivityViewer,
  filters: ActivityFilters,
  options: { limit: number; cursor?: string }
): Promise<{ data: ActivityEntry[]; nextCursor: string | null }> {
  const conditions = baseWhere(viewer, filters)
  if (options.cursor) {
    const cursor = decodeCursor(options.cursor)
    conditions.push(afterCursor(cursor.timestamp, cursor.id))
  }

  const pageSize = Math.min(Math.max(options.limit, 1), 100)
  let batchSize = Math.min(Math.max(pageSize * 4, 40), 200)
  let scanned = 0
  const result: ActivityEntry[] = []
  let nextCursor: string | null = null
  let lastScanned: { createdAt: Date; id: string } | null = null
  let pageConditions = conditions

  while (result.length < pageSize && scanned < 1000) {
    const candidates = await prisma.auditLog.findMany({
      where: { AND: pageConditions },
      include: auditInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(batchSize, 1000 - scanned)
    })
    if (!candidates.length) break
    scanned += candidates.length

    const byType = new Map<ActivityEntityType, string[]>()
    for (const candidate of candidates) {
      const type = candidate.entityType as ActivityEntityType
      if (!ACTIVITY_ENTITY_TYPES.includes(type) || !candidate.entityId) continue
      const ids = byType.get(type) || []
      ids.push(candidate.entityId)
      byType.set(type, ids)
    }
    const typeGroups = Array.from(byType.entries())
    const loadedGroups = await Promise.all(
      typeGroups.map(async ([type, ids]) => [type, await loadAccessibleEntities(type, ids, viewer)] as const)
    )
    const accessible = new Map<string, ActivityEntityInfo>()
    for (const [type, entities] of loadedGroups) {
      for (const entity of entities) accessible.set(`${type}:${entity.id}`, entity)
    }

    for (const candidate of candidates) {
      const entity = accessible.get(`${candidate.entityType}:${candidate.entityId}`)
      if (!entity) continue
      result.push(toEntry(candidate, entity))
      if (result.length === pageSize) {
        nextCursor = encodeCursor(candidate.createdAt, candidate.id)
        break
      }
    }

    const last = candidates[candidates.length - 1]
    lastScanned = { createdAt: last.createdAt, id: last.id }
    pageConditions = [...conditions, afterCursor(last.createdAt, last.id)]
    batchSize = Math.min(batchSize * 2, 200)
  }

  // The bounded scan may end before all inaccessible candidates are exhausted.
  // Expose a cursor so clients can continue rather than silently seeing a short page.
  if (!nextCursor && scanned >= 1000 && lastScanned) {
    nextCursor = encodeCursor(lastScanned.createdAt, lastScanned.id)
  }

  return { data: result, nextCursor }
}

export async function listEntityActivity(
  viewer: ActivityViewer,
  type: ActivityEntityType,
  entityId: string,
  filters: ActivityFilters,
  options: { page: number; limit: number; skip: number }
): Promise<{ data: ActivityEntry[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
  // Same access check as the underlying entity API; inaccessible means "not found".
  const entities = await loadAccessibleEntities(type, [entityId], viewer)
  if (!entities.length) throw createError('Activity not found', 404)

  const where: Prisma.AuditLogWhereInput = {
    AND: [
      ...baseWhere(viewer, filters).filter((condition) =>
        !(condition.entityType && typeof condition.entityType === 'object' && 'in' in condition.entityType)
      ),
      { entityType: type, entityId }
    ]
  }
  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: auditInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: options.skip,
      take: options.limit
    })
  ])
  return {
    data: logs.map((log) => toEntry(log, entities[0])),
    pagination: { page: options.page, limit: options.limit, total, pages: Math.ceil(total / options.limit) }
  }
}
