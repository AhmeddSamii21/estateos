export const PROPERTY_IMPORT_HEADERS = [
  'referenceNumber',
  'title',
  'type',
  'classification',
  'status',
  'address',
  'city',
  'country',
  'price',
  'currency',
  'bedrooms',
  'bathrooms',
  'area',
  'areaUnit',
  'yearBuilt',
  'condition',
  'occupancyStatus',
  'availableFrom',
  // Package 34 comparison metadata and Package 38 template parity.
  'features',
  'paymentTerms',
  'latitude',
  'longitude',
  'ownerId',
  'assignedAgentId'
] as const

export const LEAD_IMPORT_HEADERS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'status',
  'source',
  'budgetMin',
  'budgetMax',
  'preferredType',
  'preferredCity',
  'preferredBedrooms',
  'preferredAreaMin',
  'preferredAreaMax',
  'propertyId',
  'assignedToId',
  'notes',
  'nextFollowUpAt',
  'lastContactedAt'
] as const

/** Shared shape of the dry-run payloads returned by the import endpoints. */
export interface CsvImportPreviewRow {
  row: number
  values: Record<string, unknown>
  errors: Array<{ field: string; message: string }>
}

export interface CsvImportPreview {
  headers: string[]
  rows: CsvImportPreviewRow[]
  validCount: number
  invalidCount: number
}

const FORMULA_PREFIX = /^[=+@\t\r]/

/** Escapes commas, quotes and newlines, and neutralizes spreadsheet formula injection. */
export function escapeCsvCell(value: string): string {
  let text = value == null ? '' : String(value)
  if (FORMULA_PREFIX.test(text)) text = `'${text}`
  if (text.startsWith('-') && !Number.isFinite(Number(text))) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** A header line plus one empty example row for users to fill in. */
export function importTemplateCsv(headers: readonly string[]): string {
  const lines = [
    headers.map((header) => escapeCsvCell(header)).join(','),
    headers.map(() => '').join(',')
  ]
  return `${lines.join('\r\n')}\r\n`
}

export function downloadImportTemplate(filename: string, headers: readonly string[]): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([importTemplateCsv(headers)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the selected file.'))
    reader.readAsText(file)
  })
}
