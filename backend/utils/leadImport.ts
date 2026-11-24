import { LeadStatus, Prisma, PropertyType } from '@prisma/client'
import type { ImportField } from './csvImport'

/** Headers intentionally match the lead CSV export/template. */
export const LEAD_IMPORT_FIELDS: ImportField[] = [
  { key: 'firstName', header: 'firstName', type: 'string', required: true, maxLength: 100 },
  { key: 'lastName', header: 'lastName', type: 'string', maxLength: 100 },
  { key: 'email', header: 'email', type: 'string', maxLength: 254 },
  { key: 'phone', header: 'phone', type: 'string', maxLength: 50 },
  {
    key: 'status',
    header: 'status',
    type: 'enum',
    allowed: Object.values(LeadStatus),
    fallback: LeadStatus.NEW
  },
  { key: 'source', header: 'source', type: 'string', maxLength: 100 },
  { key: 'budgetMin', header: 'budgetMin', type: 'money', min: 0 },
  { key: 'budgetMax', header: 'budgetMax', type: 'money', min: 0 },
  { key: 'preferredType', header: 'preferredType', type: 'enum', allowed: Object.values(PropertyType) },
  { key: 'preferredCity', header: 'preferredCity', type: 'string', maxLength: 120 },
  { key: 'preferredBedrooms', header: 'preferredBedrooms', type: 'number', min: 0 },
  { key: 'preferredAreaMin', header: 'preferredAreaMin', type: 'number', min: 0 },
  { key: 'preferredAreaMax', header: 'preferredAreaMax', type: 'number', min: 0 },
  { key: 'propertyId', header: 'propertyId', type: 'string', maxLength: 100 },
  { key: 'assignedToId', header: 'assignedToId', type: 'string', maxLength: 100 },
  { key: 'notes', header: 'notes', type: 'string', maxLength: 5000 },
  { key: 'nextFollowUpAt', header: 'nextFollowUpAt', type: 'date' },
  { key: 'lastContactedAt', header: 'lastContactedAt', type: 'date' }
]

export type LeadImportData = Omit<Prisma.LeadCreateInput, 'assignedTo' | 'property'>

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

/** Converts validated preview values into the same shapes used by POST /leads. */
export function leadImportData(values: Record<string, unknown>): LeadImportData {
  return {
    firstName: text(values, 'firstName') ?? '',
    lastName: text(values, 'lastName'),
    email: text(values, 'email'),
    phone: text(values, 'phone'),
    status: (text(values, 'status') as LeadStatus | undefined) ?? LeadStatus.NEW,
    source: text(values, 'source'),
    notes: text(values, 'notes'),
    budgetMin: text(values, 'budgetMin'),
    budgetMax: text(values, 'budgetMax'),
    preferredType: text(values, 'preferredType') as PropertyType | undefined,
    preferredCity: text(values, 'preferredCity'),
    preferredBedrooms: numeric(values, 'preferredBedrooms'),
    preferredAreaMin: numeric(values, 'preferredAreaMin'),
    preferredAreaMax: numeric(values, 'preferredAreaMax'),
    nextFollowUpAt: dateOnly(values, 'nextFollowUpAt'),
    lastContactedAt: dateOnly(values, 'lastContactedAt')
  }
}
