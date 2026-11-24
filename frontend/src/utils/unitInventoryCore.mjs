// Package 42: pure visual unit-inventory grid grouping and status colors.

export const UNIT_STATUS_META = Object.freeze({
  AVAILABLE: Object.freeze({ en: 'Available', ar: 'متاح', color: '#16A34A' }),
  RESERVED: Object.freeze({ en: 'Reserved', ar: 'محجوز', color: '#F59E0B' }),
  SOLD: Object.freeze({ en: 'Sold', ar: 'مباع', color: '#2563EB' }),
  RENTED: Object.freeze({ en: 'Rented', ar: 'مؤجر', color: '#7C3AED' }),
  MAINTENANCE: Object.freeze({ en: 'Maintenance', ar: 'صيانة', color: '#DC2626' }),
  UNKNOWN: Object.freeze({ en: 'Unknown', ar: 'غير معروف', color: '#6B7280' })
})

export function unitStatus(property = {}) {
  const status = String(property.status || '').toUpperCase()
  const occupancy = String(property.occupancyStatus || '').toUpperCase()
  if (occupancy.includes('MAINTENANCE') || status === 'UNAVAILABLE') return 'MAINTENANCE'
  if (status === 'SOLD' || occupancy === 'SOLD') return 'SOLD'
  if (status === 'RENTED' || occupancy === 'RENTED' || occupancy.includes('OCCUPIED')) return 'RENTED'
  if (status === 'RESERVED' || status === 'PENDING' || status === 'UNDER_NEGOTIATION' || occupancy === 'RESERVED') return 'RESERVED'
  if (status === 'AVAILABLE' || occupancy === 'VACANT') return 'AVAILABLE'
  return 'UNKNOWN'
}

export function unitLabel(property = {}) {
  return String(property.unitNumber || property.referenceNumber || property.id || '—').slice(0, 40)
}

function floorNumber(property) {
  const value = Number(property.floors)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

export function buildUnitGrid(properties = [], options = {}) {
  const language = options.language === 'ar' ? 'ar' : 'en'
  const groups = new Map()
  const counts = {}
  for (const status of Object.keys(UNIT_STATUS_META)) counts[status] = 0

  for (const property of properties) {
    const status = unitStatus(property)
    counts[status] += 1
    const project = String(property.projectName || options.defaultProject || 'Unassigned')
    const building = String(property.buildingName || options.defaultBuilding || 'Main building')
    const floor = floorNumber(property)
    const groupKey = `${project}\u0000${building}`
    if (!groups.has(groupKey)) groups.set(groupKey, { project, building, floors: new Map() })
    const group = groups.get(groupKey)
    if (!group.floors.has(floor)) group.floors.set(floor, [])
    group.floors.get(floor).push({
      id: property.id,
      label: unitLabel(property),
      title: property.title,
      status,
      color: UNIT_STATUS_META[status].color,
      price: Number(property.price ?? 0),
      currency: property.currency || 'USD',
      bedrooms: Number(property.bedrooms ?? 0),
      type: property.type || 'APARTMENT'
    })
  }

  const result = [...groups.values()].map((group) => ({
    project: group.project,
    building: group.building,
    floors: [...group.floors.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([floor, units]) => ({
        floor,
        label: floor === 0 ? (language === 'ar' ? 'الأرضي' : 'Ground') : `${language === 'ar' ? 'الدور' : 'Floor'} ${floor}`,
        units: units.sort((a, b) => a.label.localeCompare(b.label))
      }))
  })).sort((a, b) => a.project.localeCompare(b.project) || a.building.localeCompare(b.building))

  return {
    groups: result,
    counts,
    total: properties.length,
    legend: Object.entries(UNIT_STATUS_META).map(([key, meta]) => ({ key, label: meta[language], color: meta.color }))
  }
}

export function unitStatusLabel(status, language = 'en') {
  return (UNIT_STATUS_META[status] || UNIT_STATUS_META.UNKNOWN)[language === 'ar' ? 'ar' : 'en']
}
