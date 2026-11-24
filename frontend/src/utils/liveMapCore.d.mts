export type MapStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'OFF_MARKET'

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

export interface AvailabilityMapResult {
  projects: ProjectAvailability[]
  units: MapPin[]
  counts: Record<MapStatus, number>
  totals: { units: number; projects: number; available: number; reserved: number; sold: number; offMarket: number }
  legend: Array<{ key: string; label: string; color: string }>
}

export declare const MAP_STATUSES: readonly string[]
export declare const MAP_STATUS_META: Readonly<Record<string, Readonly<{ en: string; ar: string; color: string }>>>
export declare function mapStatus(property?: Record<string, any>): MapStatus
export declare function toMapPin(property?: Record<string, any>): MapPin
export declare function filterMapProperties(properties?: Record<string, any>[], filters?: Record<string, any>): Record<string, any>[]
export declare function buildAvailabilityMap(properties?: Record<string, any>[], options?: { language?: string; filters?: Record<string, any> }): AvailabilityMapResult
export declare function masterplanDataUrl(label?: string, language?: string): string
export declare function mapStatusLabel(status: string, language?: string): string
