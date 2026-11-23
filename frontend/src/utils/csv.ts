export interface CsvColumn {
  key: string
  label: string
}

export type CsvRow = Record<string, unknown>

const FORMULA_PREFIX = /^[=+@\t\r]/

/** Escapes commas, quotes and newlines, and neutralizes spreadsheet formula injection. */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text: string
  if (value instanceof Date) text = value.toISOString()
  else if (typeof value === 'object') text = JSON.stringify(value)
  else text = String(value)

  if (typeof value === 'string' && FORMULA_PREFIX.test(text)) text = `'${text}`
  // A leading minus is a legitimate negative number; only quote-prefix other text starting with '-'.
  if (typeof value === 'string' && text.startsWith('-') && !Number.isFinite(Number(text))) text = `'${text}`

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** UTF-8 BOM keeps Arabic headers readable in Excel; CRLF is the CSV standard. */
export function buildCsv(columns: CsvColumn[], rows: CsvRow[]): string {
  const lines = [columns.map((column) => escapeCsvCell(column.label)).join(',')]
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvCell(row[column.key])).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export function downloadCsv(filename: string, columns: CsvColumn[], rows: CsvRow[]): void {
  const blob = new Blob([buildCsv(columns, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
