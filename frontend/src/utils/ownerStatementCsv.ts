import type { OwnerStatement } from '@/types'

function cell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Builds the CSV from the statement actually returned by the API. Restricted
 * statements never contain monetary rows, so a finance-only marker is written
 * instead of inventing zero values.
 */
export function ownerStatementCsv(statement: OwnerStatement): string {
  const rows: Array<Array<string | number>> = [
    ['Section', 'Metric', 'Currency', 'Value'],
    ['Owner', 'Name', '', statement.owner.displayName || ''],
    ['Statement', 'Generated at', '', statement.generatedAt],
    ['Properties', 'Count', '', statement.properties.count],
    ['Properties', 'Active', '', statement.properties.activeCount]
  ]
  for (const [status, count] of Object.entries(statement.properties.byStatus || {})) {
    rows.push(['Properties', 'Status', status, count])
  }
  rows.push(['Deals', 'Count', '', statement.deals.count])
  for (const [status, count] of Object.entries(statement.deals.byStatus || {})) {
    rows.push(['Deals', 'Status', status, count])
  }
  if (statement.financialsRestricted || !statement.financials) {
    rows.push(['Financials', 'Restricted', '', 'Financial figures are available to finance roles only'])
  } else {
    for (const row of statement.financials.currencies) {
      rows.push(
        ['Financials', 'Listed property value', row.currency, row.properties.listedValue],
        ['Financials', 'Deal amount', row.currency, row.deals.amount],
        ['Financials', 'Collected payments', row.currency, row.payments.collected],
        ['Financials', 'Paid property expenses', row.currency, row.expenses.paid],
        ['Financials', 'Net collected', row.currency, row.net]
      )
    }
  }
  return rows.map((row) => row.map(cell).join(',')).join('\r\n')
}
