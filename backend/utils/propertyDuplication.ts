/**
 * Duplicate drafts use an allowlist: a new listing inherits listing content
 * only. Identifiers, share links, lifecycle state, organization/agent links,
 * timestamps, audit/activity arrays and financial relations are never copied.
 *
 * The schema has no dedicated `amenities` column; amenity-like listing fields
 * (bedrooms, bathrooms, floors, area, condition, occupancy, year built and the
 * negotiable flag) are covered by the allowlist below.
 */
export const DUPLICATE_DRAFT_FIELDS = [
  'title',
  'type',
  'classification',
  'description',
  'address',
  'city',
  'state',
  'country',
  'postalCode',
  'latitude',
  'longitude',
  'area',
  'areaUnit',
  'bedrooms',
  'bathrooms',
  'floors',
  'yearBuilt',
  'condition',
  'occupancyStatus',
  'negotiable',
  'price',
  'currency',
  'ownerId'
] as const

export const DUPLICATE_STRIPPED_FIELDS = [
  'id',
  'referenceNumber',
  'publicShareToken',
  'shareToken',
  'publicShareEnabled',
  'publicShareExpiresAt',
  'publicShareCreatedAt',
  'status',
  'organizationId',
  'assignedAgentId',
  'owner',
  'assignedAgent',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'isActive',
  'activities',
  'deals',
  'payments',
  'expenses',
  'commissions',
  'leads',
  'appointments',
  'maintenanceRequests',
  'images',
  'documents',
  'linkedDocuments',
  'PropertyDocument',
  '_count',
  'operationalNotes',
  'saleRentRatio',
  'reservedUntil',
  'availableFrom',
  'featured'
] as const

type SourceRecord = Record<string, unknown>

function scalar(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && value !== null && 'toString' in value) return String(value)
  if (typeof value === 'object' || typeof value === 'function') return undefined
  return value
}

export function buildDuplicateDraft(source: SourceRecord): SourceRecord {
  const draft: SourceRecord = {}
  for (const field of DUPLICATE_DRAFT_FIELDS) {
    const value = scalar(source[field])
    if (value !== undefined) draft[field] = value
  }
  // The source status is stripped here; the new-property form always resets a
  // duplicate to AVAILABLE. Reservation windows and share tokens are stripped
  // as well.
  return draft
}
