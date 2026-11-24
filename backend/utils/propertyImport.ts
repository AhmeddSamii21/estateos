import { createHash } from 'node:crypto'
import {
  AreaUnit,
  OccupancyStatus,
  Prisma,
  PropertyClassification,
  PropertyCondition,
  PropertyStatus,
  PropertyType
} from '@prisma/client'
import type { ImportField } from './csvImport'

/** Headers intentionally match the property CSV export/template. */
export const PROPERTY_IMPORT_FIELDS: ImportField[] = [
  { key: 'referenceNumber', header: 'referenceNumber', type: 'string', maxLength: 100 },
  { key: 'title', header: 'title', type: 'string', required: true, maxLength: 200 },
  { key: 'type', header: 'type', type: 'enum', required: true, allowed: Object.values(PropertyType) },
  {
    key: 'classification',
    header: 'classification',
    type: 'enum',
    allowed: Object.values(PropertyClassification),
    fallback: PropertyClassification.SALE
  },
  {
    key: 'status',
    header: 'status',
    type: 'enum',
    allowed: Object.values(PropertyStatus),
    fallback: PropertyStatus.AVAILABLE
  },
  { key: 'address', header: 'address', type: 'string', maxLength: 500 },
  { key: 'city', header: 'city', type: 'string', maxLength: 120 },
  { key: 'country', header: 'country', type: 'string', maxLength: 120 },
  { key: 'price', header: 'price', type: 'money', min: 0, fallback: '0.00' },
  { key: 'currency', header: 'currency', type: 'string', maxLength: 3, fallback: 'USD' },
  { key: 'bedrooms', header: 'bedrooms', type: 'number', min: 0, fallback: 0 },
  { key: 'bathrooms', header: 'bathrooms', type: 'number', min: 0, fallback: 0 },
  { key: 'area', header: 'area', type: 'number', min: 0 },
  { key: 'areaUnit', header: 'areaUnit', type: 'enum', allowed: Object.values(AreaUnit), fallback: AreaUnit.SQ_M },
  { key: 'yearBuilt', header: 'yearBuilt', type: 'number', min: 1800, max: 2100 },
  {
    key: 'condition',
    header: 'condition',
    type: 'enum',
    allowed: Object.values(PropertyCondition),
    fallback: PropertyCondition.GOOD
  },
  { key: 'occupancyStatus', header: 'occupancyStatus', type: 'enum', allowed: Object.values(OccupancyStatus) },
  { key: 'availableFrom', header: 'availableFrom', type: 'date' },
  // Package 34 comparison metadata is template-compatible with CSV export.
  { key: 'features', header: 'features', type: 'string', maxLength: 2000 },
  { key: 'paymentTerms', header: 'paymentTerms', type: 'string', maxLength: 2000 },
  { key: 'latitude', header: 'latitude', type: 'number', min: -90, max: 90 },
  { key: 'longitude', header: 'longitude', type: 'number', min: -180, max: 180 },
  { key: 'ownerId', header: 'ownerId', type: 'string', maxLength: 100 },
  { key: 'assignedAgentId', header: 'assignedAgentId', type: 'string', maxLength: 100 }
]

export type PropertyImportData = Omit<
  Prisma.PropertyCreateInput,
  'organization' | 'organizationId' | 'owner' | 'assignedAgent'
>

function text(values: Record<string, unknown>, key: string): string | undefined {
  const value = values[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numeric(values: Record<string, unknown>, key: string): number | undefined {
  const value = values[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function dateOnly(values: Record<string, unknown>, key: string): Date | undefined {
  const value = text(values, key)
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Stable fallback for callers that do not supply a per-row reference number. */
function generatedReferenceNumber(values: Record<string, unknown>): string {
  const stable = Object.keys(values)
    .sort()
    .map((key) => `${key}=${String(values[key])}`)
    .join('|')
  return `PROP-${createHash('sha256').update(stable).digest('hex').slice(0, 12).toUpperCase()}`
}

/** Converts validated preview values into the same shapes used by POST /properties. */
export function propertyImportData(
  values: Record<string, unknown>,
  fallbackReferenceNumber?: string
): PropertyImportData {
  const referenceNumber = text(values, 'referenceNumber')
    ?? (fallbackReferenceNumber?.trim() || generatedReferenceNumber(values))
  return {
    referenceNumber,
    title: text(values, 'title') ?? '',
    type: text(values, 'type') as PropertyType,
    classification: (text(values, 'classification') as PropertyClassification | undefined) ?? PropertyClassification.SALE,
    status: (text(values, 'status') as PropertyStatus | undefined) ?? PropertyStatus.AVAILABLE,
    address: text(values, 'address'),
    city: text(values, 'city'),
    country: text(values, 'country'),
    price: text(values, 'price') ?? '0.00',
    currency: (text(values, 'currency') ?? 'USD').toUpperCase(),
    bedrooms: numeric(values, 'bedrooms') ?? 0,
    bathrooms: numeric(values, 'bathrooms') ?? 0,
    area: numeric(values, 'area'),
    areaUnit: (text(values, 'areaUnit') as AreaUnit | undefined) ?? AreaUnit.SQ_M,
    yearBuilt: numeric(values, 'yearBuilt'),
    condition: (text(values, 'condition') as PropertyCondition | undefined) ?? PropertyCondition.GOOD,
    occupancyStatus: text(values, 'occupancyStatus') as OccupancyStatus | undefined,
    availableFrom: dateOnly(values, 'availableFrom'),
    features: text(values, 'features'),
    paymentTerms: text(values, 'paymentTerms'),
    latitude: numeric(values, 'latitude'),
    longitude: numeric(values, 'longitude')
  }
}
