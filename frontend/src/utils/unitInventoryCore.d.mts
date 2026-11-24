export interface UnitLike {
  id?: string
  unitNumber?: string | null
  referenceNumber?: string | null
  title?: string
  status?: string
  occupancyStatus?: string | null
  floors?: number | null
  projectName?: string | null
  buildingName?: string | null
  price?: unknown
  currency?: string
  bedrooms?: number
  type?: string
}

export interface UnitCell {
  id: string
  label: string
  title: string
  status: string
  color: string
  price: number
  currency: string
  bedrooms: number
  type: string
}

export interface UnitFloor {
  floor: number
  label: string
  units: UnitCell[]
}

export declare const UNIT_STATUS_META: Readonly<Record<string, Readonly<{ en: string; ar: string; color: string }>>>

export declare function unitStatus(property?: UnitLike): string
export declare function unitLabel(property?: UnitLike): string
export declare function buildUnitGrid(properties?: UnitLike[], options?: { language?: string; defaultProject?: string; defaultBuilding?: string }): {
  groups: Array<{ project: string; building: string; floors: UnitFloor[] }>
  counts: Record<string, number>
  total: number
  legend: Array<{ key: string; label: string; color: string }>
}
export declare function unitStatusLabel(status: string, language?: string): string
