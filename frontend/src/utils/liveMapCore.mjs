// Package 44: pure live-availability map aggregation and bilingual pin meta.
// Shared by the Vue map view and the browser demo adapter.

import { unitStatus } from './unitInventoryCore.mjs'

export const MAP_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD', 'OFF_MARKET']
export const MAP_STATUS_META = Object.freeze({
  AVAILABLE: Object.freeze({ en: 'Available', ar: 'متاح', color: '#10B981' }),
  RESERVED: Object.freeze({ en: 'Reserved', ar: 'محجوز', color: '#F59E0B' }),
  SOLD: Object.freeze({ en: 'Sold', ar: 'مباع', color: '#F43F5E' }),
  OFF_MARKET: Object.freeze({ en: 'Off Market', ar: 'خارج السوق', color: '#64748B' })
})

function finite(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bounded(value, min, max) {
  const parsed = finite(value)
  return parsed !== null && parsed >= min && parsed <= max ? parsed : null
}

/**
 * Normalize every property into the exact bucket used by pins, counters,
 * filters and the inspection drawer. OFF_MARKET must be checked before the
 * generic inventory normalizer, which otherwise folds it into UNKNOWN.
 */
export function mapStatus(property = {}) {
  const raw = String(property.status || '').toUpperCase()
  const occupancy = String(property.occupancyStatus || '').toUpperCase()
  if (raw === 'OFF_MARKET' || occupancy === 'OFF_MARKET') return 'OFF_MARKET'
  const normalized = unitStatus(property)
  if (normalized === 'AVAILABLE') return 'AVAILABLE'
  if (normalized === 'SOLD') return 'SOLD'
  return 'RESERVED'
}

export function toMapPin(property = {}) {
  const status = mapStatus(property)
  const project = String(property.projectName || 'Unassigned')
  const latitude = bounded(property.unitLatitude, -90, 90) ?? bounded(property.latitude, -90, 90)
  const longitude = bounded(property.unitLongitude, -180, 180) ?? bounded(property.longitude, -180, 180)
  const mapX = bounded(property.mapX, 0, 100)
  const mapY = bounded(property.mapY, 0, 100)
  const label = String(property.unitNumber || property.referenceNumber || property.id || '—')
  return {
    id: String(property.id || label),
    project,
    projectName: project,
    cityArea: property.cityArea || property.state || null,
    building: String(property.buildingName || 'Main building'),
    unitNumber: String(property.unitNumber || label),
    label,
    title: String(property.title || label),
    status,
    rawStatus: String(property.status || '').toUpperCase(),
    color: MAP_STATUS_META[status].color,
    price: Number(property.price ?? 0) || 0,
    currency: String(property.currency || 'USD'),
    area: finite(property.area) ?? 0,
    bedrooms: Number(property.bedrooms ?? 0) || 0,
    floor: Number(property.floors ?? 0) || 0,
    type: String(property.type || 'APARTMENT'),
    latitude,
    longitude,
    mapX,
    mapY,
    hasGeoPin: latitude !== null && longitude !== null,
    hasMasterplanPin: mapX !== null && mapY !== null
  }
}

export function filterMapProperties(properties = [], filters = {}) {
  const project = filters.project ? String(filters.project).trim() : ''
  const type = filters.type ? String(filters.type).toUpperCase() : ''
  const minPrice = finite(filters.minPrice)
  const maxPrice = finite(filters.maxPrice)
  return properties.filter((property) => {
    if (project && String(property.projectName || 'Unassigned') !== project) return false
    if (type && String(property.type || '').toUpperCase() !== type) return false
    if (filters.status && mapStatus(property) !== filters.status) return false
    const price = Number(property.price ?? 0) || 0
    if (minPrice !== null && price < minPrice) return false
    if (maxPrice !== null && price > maxPrice) return false
    return true
  })
}

export function buildAvailabilityMap(properties = [], options = {}) {
  const language = options.language === 'ar' ? 'ar' : 'en'
  const filters = options.filters || {}
  const units = filterMapProperties(properties, filters).map(toMapPin)
  const counts = { AVAILABLE: 0, RESERVED: 0, SOLD: 0, OFF_MARKET: 0 }
  const grouped = new Map()

  for (const unit of units) {
    counts[unit.status] += 1
    if (!grouped.has(unit.project)) {
      const source = properties.find((property) => String(property.projectName || 'Unassigned') === unit.project) || {}
      grouped.set(unit.project, {
        key: unit.project,
        name: unit.project,
        cityArea: source.cityArea || source.state || source.city || null,
        latitude: bounded(source.latitude, -90, 90),
        longitude: bounded(source.longitude, -180, 180),
        center: null,
        masterplanImageUrl: source.masterplanImageUrl || null,
        counts: { AVAILABLE: 0, RESERVED: 0, SOLD: 0, OFF_MARKET: 0 },
        total: 0,
        minPrice: null,
        maxPrice: null,
        currency: source.currency || null,
        unitTypes: [],
        units: []
      })
    }
    const project = grouped.get(unit.project)
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
      const lat = geoUnits.reduce((sum, unit) => sum + unit.latitude, 0) / geoUnits.length
      const lng = geoUnits.reduce((sum, unit) => sum + unit.longitude, 0) / geoUnits.length
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
    legend: MAP_STATUSES.map((key) => ({
      key,
      label: MAP_STATUS_META[key][language === 'ar' ? 'ar' : 'en'],
      color: MAP_STATUS_META[key].color
    }))
  }
}

/** Offline masterplan for projects without a hosted image (standalone demo). */
export function masterplanDataUrl(label = 'EstateOS', language = 'en') {
  const title = language === 'ar' ? `مخطط ${label}` : `${label} masterplan`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700"><rect width="1000" height="700" fill="#eef2ff"/><path d="M0 350H1000M500 0V700" stroke="#fff" stroke-width="34"/><g fill="#c7d2fe" stroke="#818cf8" stroke-width="4"><rect x="90" y="90" width="330" height="210" rx="16"/><rect x="580" y="90" width="330" height="210" rx="16"/><rect x="90" y="420" width="330" height="210" rx="16"/><rect x="580" y="420" width="330" height="210" rx="16"/></g><text x="90" y="55" font-size="26" font-family="sans-serif" fill="#3730a3">${title}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function mapStatusLabel(status, language = 'en') {
  return (MAP_STATUS_META[status] || MAP_STATUS_META.RESERVED)[language === 'ar' ? 'ar' : 'en']
}
