import { ExpenseStatus, PaymentStatus, Prisma, Role } from '@prisma/client'
import { FINANCE_ROLES, ownerReadScope } from './scope'
import { sumMoney } from './money'

/**
 * Owner statement building and scoping helpers.
 *
 * Owner records predate mandatory organization ownership, so the same
 * ownerReadScope used by GET /owners/:id gates statement access. Related rows
 * are additionally scoped to the viewer's organization, and monetary fields
 * are only queried/serialized for finance roles.
 */

export type StatementMoney = string | number | Prisma.Decimal | { toString(): string }

export interface StatementOwner {
  id: string
  displayName?: string | null
}

export interface StatementProperty {
  id: string
  title: string
  referenceNumber: string
  status: string
  city?: string | null
  price: StatementMoney
  currency?: string | null
  isActive?: boolean
}

export interface StatementDeal {
  id: string
  status: string
  type?: string | null
  amount?: StatementMoney
  currency?: string | null
}

export interface StatementPayment {
  id: string
  status: string
  amount: StatementMoney
  currency?: string | null
}

export interface StatementExpense {
  id: string
  status: string
  amount: StatementMoney
  currency?: string | null
}

export interface OwnerStatementRows {
  properties: StatementProperty[]
  deals: StatementDeal[]
  payments?: StatementPayment[]
  expenses?: StatementExpense[]
}

export interface CurrencyBreakdown {
  currency: string
  properties: { count: number; listedValue: string }
  deals: { count: number; amount: string }
  payments: { count: number; collected: string }
  expenses: { count: number; paid: string }
  net: string
}

export interface OwnerStatement {
  owner: StatementOwner
  generatedAt: string
  properties: {
    count: number
    activeCount: number
    byStatus: Record<string, number>
    list: Array<Pick<StatementProperty, 'id' | 'title' | 'referenceNumber' | 'status' | 'city'> & {
      price?: StatementMoney
      currency?: string | null
    }>
  }
  deals: { count: number; byStatus: Record<string, number>; byType: Record<string, number> }
  financialsRestricted: boolean
  financials?: { currencies: CurrencyBreakdown[] }
}

export function canViewOwnerFinancials(role: Role | undefined): boolean {
  return Boolean(role && FINANCE_ROLES.includes(role))
}

export function ownerStatementOwnerWhere(organizationId: string, id: string): Prisma.OwnerWhereInput {
  return { id, ...ownerReadScope(organizationId), deletedAt: null }
}

export function ownerStatementPropertyWhere(organizationId: string, ownerId: string): Prisma.PropertyWhereInput {
  return { ownerId, organizationId, deletedAt: null }
}

export function ownerStatementDealWhere(organizationId: string, propertyIds: string[]): Prisma.DealWhereInput {
  return { organizationId, propertyId: { in: propertyIds }, deletedAt: null }
}

export function ownerStatementPaymentWhere(dealIds: string[]): Prisma.PaymentWhereInput {
  return { dealId: { in: dealIds }, status: PaymentStatus.COMPLETED, deletedAt: null }
}

export function ownerStatementExpenseWhere(propertyIds: string[]): Prisma.ExpenseWhereInput {
  return { propertyId: { in: propertyIds }, status: ExpenseStatus.PAID, deletedAt: null }
}

function currencyCode(value: string | null | undefined): string {
  const code = (value || '').trim().toUpperCase()
  return code || 'UNSPECIFIED'
}

function countBy(rows: Array<{ status?: string | null }>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const row of rows) {
    const key = row.status || 'UNSPECIFIED'
    result[key] = (result[key] || 0) + 1
  }
  return result
}

function countTypes(rows: Array<{ type?: string | null }>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const row of rows) {
    const key = row.type || 'UNSPECIFIED'
    result[key] = (result[key] || 0) + 1
  }
  return result
}

export function buildOwnerStatement(
  owner: StatementOwner,
  rows: OwnerStatementRows,
  options: { includeFinancials: boolean; generatedAt?: Date }
): OwnerStatement {
  const properties = rows.properties || []
  const deals = rows.deals || []
  const payments = options.includeFinancials ? (rows.payments || []) : []
  const expenses = options.includeFinancials ? (rows.expenses || []) : []
  const includeFinancials = options.includeFinancials

  const statement: OwnerStatement = {
    owner: { id: owner.id, displayName: owner.displayName || null },
    generatedAt: (options.generatedAt || new Date()).toISOString(),
    properties: {
      count: properties.length,
      activeCount: properties.filter((property) => property.isActive !== false).length,
      byStatus: countBy(properties),
      list: properties.map((property) => ({
        id: property.id,
        title: property.title,
        referenceNumber: property.referenceNumber,
        status: property.status,
        city: property.city ?? null,
        ...(includeFinancials
          ? { price: property.price, currency: property.currency ?? null }
          : {})
      }))
    },
    deals: { count: deals.length, byStatus: countBy(deals), byType: countTypes(deals) },
    financialsRestricted: !includeFinancials
  }

  if (includeFinancials) {
    const codes = new Set<string>([
      ...properties.map((property) => currencyCode(property.currency)),
      ...deals.map((deal) => currencyCode(deal.currency)),
      ...payments.map((payment) => currencyCode(payment.currency)),
      ...expenses.map((expense) => currencyCode(expense.currency))
    ])
    const currencies: CurrencyBreakdown[] = Array.from(codes).sort().map((currency) => {
      const propertyRows = properties.filter((property) => currencyCode(property.currency) === currency)
      const dealRows = deals.filter((deal) => currencyCode(deal.currency) === currency)
      const paymentRows = payments.filter((payment) => currencyCode(payment.currency) === currency)
      const expenseRows = expenses.filter((expense) => currencyCode(expense.currency) === currency)
      const collected = sumMoney(paymentRows.map((payment) => payment.amount))
      const paid = sumMoney(expenseRows.map((expense) => expense.amount))
      return {
        currency,
        properties: {
          count: propertyRows.length,
          listedValue: sumMoney(propertyRows.map((property) => property.price))
        },
        deals: {
          count: dealRows.length,
          amount: sumMoney(dealRows.map((deal) => deal.amount ?? 0))
        },
        payments: { count: paymentRows.length, collected },
        expenses: { count: expenseRows.length, paid },
        net: new Prisma.Decimal(collected).minus(paid).toFixed(2)
      }
    })
    statement.financials = { currencies }
  }

  return statement
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV mirrors the visible statement: restricted figures never reach the file. */
export function ownerStatementCsv(statement: OwnerStatement): string {
  const rows: Array<Array<string | number>> = [
    ['Section', 'Metric', 'Currency', 'Value'],
    ['Owner', 'Name', '', statement.owner.displayName || ''],
    ['Statement', 'Generated at', '', statement.generatedAt],
    ['Properties', 'Count', '', statement.properties.count],
    ['Properties', 'Active', '', statement.properties.activeCount]
  ]
  for (const [status, count] of Object.entries(statement.properties.byStatus)) {
    rows.push(['Properties', 'Status', status, count])
  }
  rows.push(['Deals', 'Count', '', statement.deals.count])
  for (const [status, count] of Object.entries(statement.deals.byStatus)) {
    rows.push(['Deals', 'Status', status, count])
  }
  if (!statement.financials || statement.financialsRestricted) {
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
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}
