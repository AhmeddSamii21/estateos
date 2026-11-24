import { Prisma } from '@prisma/client'
import { parseMoney } from './money'
import {
  dateValue,
  enumValue,
  failValidation,
  numberValue,
  optionalString,
  requiredString,
  ValidationError,
  type ValidationIssue
} from './validation'

export interface ImportField {
  key: string
  header: string
  required?: boolean
  type: 'string' | 'enum' | 'number' | 'money' | 'date'
  allowed?: readonly string[]
  maxLength?: number
  min?: number
  max?: number
  fallback?: unknown
}

export interface ImportRowResult {
  row: number
  values: Record<string, unknown>
  errors: Array<{ field: string; message: string }>
}

export interface ImportPreview {
  headers: string[]
  rows: ImportRowResult[]
  validCount: number
  invalidCount: number
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

/** RFC4180-style parser: quoted commas/newlines, doubled quotes, CRLF and BOM. */
export function parseCsv(text: string): { headers: string[]; records: Array<{ row: number; cells: Record<string, string> }> } {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const parsedRows: string[][] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]
    if (quoted) {
      if (character === '"') {
        if (normalized[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += character
      }
      continue
    }
    if (character === '"' && cell.length === 0) {
      quoted = true
    } else if (character === ',') {
      cells.push(cell)
      cell = ''
    } else if (character === '\n') {
      cells.push(cell)
      parsedRows.push(cells)
      cells = []
      cell = ''
    } else {
      cell += character
    }
  }
  if (cell.length > 0 || cells.length > 0) {
    cells.push(cell)
    parsedRows.push(cells)
  }

  const dataRows = parsedRows.slice(1).filter((row) => !(row.length === 1 && row[0].trim() === ''))
  const headers = (parsedRows[0] ?? []).map((header) => header.trim())
  const records = dataRows.map((row, index) => {
    const values: Record<string, string> = {}
    headers.forEach((header, column) => {
      if (header && column < row.length) values[header] = row[column]
    })
    return { row: index + 1, cells: values }
  })
  return { headers, records }
}

function cellForField(headers: string[], field: ImportField): string | undefined {
  const lookup = new Map<string, string>()
  for (const header of headers) {
    const normalized = normalizeHeader(header)
    if (!lookup.has(normalized)) lookup.set(normalized, header)
  }
  return lookup.get(normalizeHeader(field.header)) ?? lookup.get(normalizeHeader(field.key))
}

function validateCell(field: ImportField, value: unknown): unknown {
  switch (field.type) {
    case 'string':
      return field.required
        ? requiredString(value, field.key, field.maxLength ?? 500)
        : optionalString(value, field.key, field.maxLength ?? 500)
    case 'enum': {
      const allowed = field.allowed ?? []
      const fallback = field.fallback as string | undefined
      return enumValue(value, field.key, allowed, fallback)
    }
    case 'number':
      return numberValue(value, field.key, { required: field.required, min: field.min, max: field.max })
    case 'money': {
      const amount = parseMoney(value, field.key, { required: field.required, min: field.min })
      if (amount !== undefined && field.max !== undefined && new Prisma.Decimal(amount).greaterThan(field.max)) {
        failValidation(field.key, `${field.key} is above the maximum`)
      }
      return amount
    }
    case 'date': {
      const date = dateValue(value, field.key, field.required === true)
      return date ? date.toISOString().slice(0, 10) : undefined
    }
  }
}

export function buildImportPreview(text: string, fields: ImportField[]): ImportPreview {
  const parsed = parseCsv(text)
  const rows = parsed.records.map((record) => {
    const errors: ValidationIssue[] = []
    const values: Record<string, unknown> = {}

    for (const field of fields) {
      const headerName = cellForField(parsed.headers, field)
      const raw = headerName ? record.cells[headerName] : undefined
      const isEmpty = raw === undefined || raw.trim() === ''
      const fallback = field.fallback
      const useFallback = isEmpty && field.required !== true && fallback !== undefined
      // Optional enums without a fallback stay absent instead of failing.
      const skip = isEmpty && !field.required && fallback === undefined && field.type === 'enum'
      if (skip) continue
      const value = useFallback ? fallback : raw

      try {
        const validated = validateCell(field, value)
        if (validated !== undefined) values[field.key] = validated
      } catch (error) {
        if (error instanceof ValidationError) {
          for (const issue of error.issues) errors.push({ field: issue.field, message: issue.message })
        } else {
          errors.push({ field: field.key, message: error instanceof Error ? error.message : 'Invalid value' })
        }
      }
    }

    return { row: record.row, values, errors }
  })

  const invalidCount = rows.filter((row) => row.errors.length > 0).length
  return {
    headers: parsed.headers,
    rows,
    validCount: rows.length - invalidCount,
    invalidCount
  }
}

export function importHeaders(fields: ImportField[]): string[] {
  return fields.map((field) => field.header)
}

function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** A header line plus one example row derived from the field definitions. */
export function importTemplate(fields: ImportField[]): string {
  const headerLine = importHeaders(fields).map(escapeCsvCell).join(',')
  const exampleLine = fields
    .map((field) => {
      if (field.fallback !== undefined) return String(field.fallback)
      if (field.type === 'enum') return field.allowed?.[0] ?? ''
      if (field.type === 'money') return '0.00'
      if (field.type === 'number') return String(field.min ?? 0)
      if (field.type === 'date') return new Date().toISOString().slice(0, 10)
      return field.required ? `example-${field.key}` : ''
    })
    .map(escapeCsvCell)
    .join(',')
  return `${headerLine}\r\n${exampleLine}\r\n`
}
