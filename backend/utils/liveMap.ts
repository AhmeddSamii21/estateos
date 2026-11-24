import { unitStatus } from './unitInventory'

/**
 * Package 44: pure live-availability aggregation shared by the map endpoints.
 * No organization filtering happens here — callers must pass an already
 * tenant/role scoped set of property rows.
 */
export const MAP_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD', 'OFF_MARKET'] as const
export type MapStatus = (typeof MAP_STATUSES)[number]

export const MAP_STATUS_META: Record<MapStatus, { en: string; ar: string; color: string }> = {
  AVAILABLE: { en: 'Available', ar: 'متاح', color: '#10B981' },
  RESERVED: { en: 'Reserved', ar: 'محجوز', color: '#F59E0B' },
  SOLD: { en: 'Sold', ar: 'مباع', color: '#F43F5E' },
  OFF_MARKET: { en: 'Off Market', ar: 'خارج السوق', color: '#64748B' }
}

export interface MapPropertyLike {
  id: string
  title?: string | null
  referenceNumber?: string | null
  status: string
  occupancyStatus?: string | null
  projectName?: string | null
  buildingName?: string | null
  unitNumber?: string | null
  city?: string | null
  cityArea?: string | null
  latitude?: unknown
  longitude?: unknown
  unitLatitude?: unknown
  unitLongitude?: unknown
  mapX?: unknown
  mapY?: unknown
  masterplanImageUrl?: string | null
  price: unknown
  currency?: string | null
  bedrooms?: number | null
  area?: unknown
  floors?: number | null
  type?: string | null
}

export interface MapFilters {
  project?: string
  status?: string
  type?: string
  minPrice?: number
  maxPrice?: number
}

export interface MapPin {
  id: string
  project: string
  projectName: string
  cityArea: string | null
  building: string
  unitNumber: string
  label: string
  title: string
  status: MapStatus
  rawStatus: string
  color: string
  price: number
  currency: string
  area: number
  bedrooms: number
  floor: number
  type: string
  latitude: number | null
  longitude: number | null
  mapX: number | null
  mapY: number | null
  hasGeoPin: boolean
  hasMasterplanPin: boolean
}

export interface ProjectAvailability {
  key: string
  name: string
  cityArea: string | null
  latitude: number | null
  longitude: number | null
  center: [number, number] | null
  masterplanImageUrl: string | null
  counts: Record<MapStatus, number>
  total: number
  minPrice: number | null
  maxPrice: number | null
  currency: string | null
  unitTypes: string[]
  units: MapPin[]
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  // Prisma Decimals are objects at this point (they serialize to strings only
  // in the HTTP response), so convert through their string representation.
  const parsed = typeof value === 'object' ? Number(String(value)) : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bounded(value: unknown, min: number, max: number): number | null {
  const parsed = finite(value)
  return parsed !== null && parsed >= min && parsed <= max ? parsed : null
}

/**
 * Normalize every property into the exact bucket used by pins, counters,
 * filters and the inspection drawer. OFF_MARKET must be checked before the
 * generic inventory normalizer, which otherwise folds it into UNKNOWN.
 */
export function mapStatus(property: Pick<MapPropertyLike, 'status' | 'occupancyStatus'>): MapStatus {
  const raw = String(property.status || '').toUpperCase()
  const occupancy = String(property.occupancyStatus || '').toUpperCase()
  if (raw === 'OFF_MARKET' || occupancy === 'OFF_MARKET') return 'OFF_MARKET'
  const normalized = unitStatus(property)
  if (normalized === 'AVAILABLE') return 'AVAILABLE'
  if (normalized === 'SOLD') return 'SOLD'
  return 'RESERVED'
}

export function toMapPin(property: MapPropertyLike): MapPin {
  const status = mapStatus(property)
  const project = property.projectName?.trim() || 'Unassigned'
  const latitude = bounded(property.unitLatitude, -90, 90) ?? bounded(property.latitude, -90, 90)
  const longitude = bounded(property.unitLongitude, -180, 180) ?? bounded(property.longitude, -180, 180)
  const mapX = bounded(property.mapX, 0, 100)
  const mapY = bounded(property.mapY, 0, 100)
  const label = property.unitNumber?.trim() || property.referenceNumber?.trim() || property.id
  return {
    id: property.id,
    project,
    projectName: project,
    cityArea: property.cityArea?.trim() || null,
    building: property.buildingName?.trim() || 'Main building',
    unitNumber: property.unitNumber?.trim() || label,
    label,
    title: property.title || label,
    status,
    rawStatus: String(property.status || '').toUpperCase(),
    color: MAP_STATUS_META[status].color,
    price: Number(property.price ?? 0) || 0,
    currency: property.currency || 'USD',
    area: finite(property.area) ?? 0,
    bedrooms: Number(property.bedrooms ?? 0) || 0,
    floor: Number(property.floors ?? 0) || 0,
    type: property.type || 'APARTMENT',
    latitude,
    longitude,
    mapX,
    mapY,
    hasGeoPin: latitude !== null && longitude !== null,
    hasMasterplanPin: mapX !== null && mapY !== null
  }
}

export function filterMapProperties(properties: MapPropertyLike[], filters: MapFilters = {}): MapPropertyLike[] {
  const project = filters.project?.trim()
  const type = filters.type?.trim().toUpperCase()
  const minPrice = finite(filters.minPrice)
  const maxPrice = finite(filters.maxPrice)
  return properties.filter((property) => {
    if (project && (property.projectName || 'Unassigned') !== project) return false
    if (type && String(property.type || '').toUpperCase() !== type) return false
    if (filters.status && mapStatus(property) !== filters.status) return false
    const price = Number(property.price ?? 0) || 0
    if (minPrice !== null && price < minPrice) return false
    if (maxPrice !== null && price > maxPrice) return false
    return true
  })
}

export function buildAvailabilityMap(properties: MapPropertyLike[], language: 'en' | 'ar' = 'en', filters: MapFilters = {}) {
  const units = filterMapProperties(properties, filters).map(toMapPin)
  const counts: Record<MapStatus, number> = { AVAILABLE: 0, RESERVED: 0, SOLD: 0, OFF_MARKET: 0 }
  const grouped = new Map<string, ProjectAvailability>()

  for (const unit of units) {
    counts[unit.status] += 1
    const key = unit.project
    let project = grouped.get(key)
    if (!project) {
      const source = properties.find((property) => (property.projectName?.trim() || 'Unassigned') === key)
      project = {
        key,
        name: key,
        cityArea: source?.cityArea?.trim() || source?.city?.trim() || null,
        latitude: bounded(source?.latitude, -90, 90),
        longitude: bounded(source?.longitude, -180, 180),
        center: null,
        masterplanImageUrl: source?.masterplanImageUrl?.trim() || null,
        counts: { AVAILABLE: 0, RESERVED: 0, SOLD: 0, OFF_MARKET: 0 },
        total: 0,
        minPrice: null,
        maxPrice: null,
        currency: source?.currency || null,
        unitTypes: [],
        units: []
      }
      grouped.set(key, project)
    }
    project.units.push(unit)
    project.counts[unit.status] += 1
    project.total += 1
    project.minPrice = project.minPrice === null ? unit.price : Math.min(project.minPrice, unit.price)
    project.maxPrice = project.maxPrice === null ? unit.price : Math.max(project.maxPrice, unit.price)
    project.currency = project.currency || unit.currency
    if (!project.unitTypes.includes(unit.type)) project.unitTypes.push(unit.type)
  }

  const projects = [...grouped.values()].map((project) => {
    const geoUnits = project.units.filter((unit) => unit.hasGeoPin)
    if (geoUnits.length) {
      const lat = geoUnits.reduce((sum, unit) => sum + (unit.latitude ?? 0), 0) / geoUnits.length
      const lng = geoUnits.reduce((sum, unit) => sum + (unit.longitude ?? 0), 0) / geoUnits.length
      project.center = [Number(lat.toFixed(6)), Number(lng.toFixed(6))]
      project.latitude = project.latitude ?? project.center[0]
      project.longitude = project.longitude ?? project.center[1]
    }
    return { ...project, unitTypes: project.unitTypes.sort() }
  }).sort((a, b) => a.name.localeCompare(b.name))

  return {
    projects,
    units,
    counts,
    totals: {
      units: units.length,
      projects: projects.length,
      available: counts.AVAILABLE,
      reserved: counts.RESERVED,
      sold: counts.SOLD,
      offMarket: counts.OFF_MARKET
    },
    legend: MAP_STATUSES.map((status) => ({
      key: status,
      label: MAP_STATUS_META[status][language === 'ar' ? 'ar' : 'en'],
      color: MAP_STATUS_META[status].color
    }))
  }
}

export type AvailabilityMapResult = ReturnType<typeof buildAvailabilityMap>
