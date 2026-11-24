import { createError } from '../middleware/errorHandler'

export const UNIT_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD', 'RENTED', 'MAINTENANCE', 'UNKNOWN'] as const
export type UnitStatus = (typeof UNIT_STATUSES)[number]

export function unitStatus(property: { status: string; occupancyStatus?: string | null }): UnitStatus {
  const status = property.status.toUpperCase()
  const occupancy = (property.occupancyStatus || '').toUpperCase()
  if (occupancy.includes('MAINTENANCE') || status === 'UNAVAILABLE') return 'MAINTENANCE'
  if (status === 'SOLD' || occupancy === 'SOLD') return 'SOLD'
  if (status === 'RENTED' || occupancy === 'RENTED' || occupancy.includes('OCCUPIED')) return 'RENTED'
  if (['RESERVED', 'PENDING', 'UNDER_NEGOTIATION'].includes(status) || occupancy === 'RESERVED') return 'RESERVED'
  if (status === 'AVAILABLE' || occupancy === 'VACANT') return 'AVAILABLE'
  return 'UNKNOWN'
}

export function buildInventoryGrid<T extends {
  id: string
  title: string
  referenceNumber: string
  status: string
  occupancyStatus?: string | null
  floors?: number | null
  projectName?: string | null
  buildingName?: string | null
  unitNumber?: string | null
  price: unknown
  currency: string
  bedrooms: number
  type: string
}>(properties: T[], language: 'en' | 'ar' = 'en') {
  const groups = new Map<string, { project: string; building: string; floors: Map<number, Array<Record<string, unknown>>> }>()
  const counts: Record<UnitStatus, number> = {
    AVAILABLE: 0, RESERVED: 0, SOLD: 0, RENTED: 0, MAINTENANCE: 0, UNKNOWN: 0
  }
  for (const property of properties) {
    const status = unitStatus(property)
    counts[status] += 1
    const project = property.projectName || 'Unassigned'
    const building = property.buildingName || 'Main building'
    const floor = Number.isFinite(property.floors ?? NaN) && (property.floors ?? 0) >= 0 ? Math.floor(property.floors!) : 0
    const key = `${project}\u0000${building}`
    if (!groups.has(key)) groups.set(key, { project, building, floors: new Map() })
    const group = groups.get(key)!
    if (!group.floors.has(floor)) group.floors.set(floor, [])
    group.floors.get(floor)!.push({
      id: property.id,
      label: property.unitNumber || property.referenceNumber,
      title: property.title,
      status,
      price: Number(property.price),
      currency: property.currency,
      bedrooms: property.bedrooms,
      type: property.type
    })
  }
  return {
    groups: [...groups.values()].map((group) => ({
      project: group.project,
      building: group.building,
      floors: [...group.floors.entries()].sort((a, b) => b[0] - a[0]).map(([floor, units]) => ({
        floor,
        label: floor === 0
          ? (language === 'ar' ? 'الأرضي' : 'Ground')
          : `${language === 'ar' ? 'الدور' : 'Floor'} ${floor}`,
        units: units.sort((a, b) => String(a.label).localeCompare(String(b.label)))
      }))
    })).sort((a, b) => a.project.localeCompare(b.project) || a.building.localeCompare(b.building)),
    counts,
    total: properties.length
  }
}

export function assertUnitText(value: unknown, field: string, max = 120): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.trim().length > max) {
    throw createError(`${field} must be a string under ${max} characters`, 400)
  }
  return value.trim()
}
