import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { createError } from '../middleware/errorHandler'

function normalizeCurrencyCode(value: unknown, field: string): string {
  const code = String(value ?? '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) throw createError(`${field} must be a 3-letter ISO currency code`, 400)
  return code
}

export { normalizeCurrencyCode }

export async function baseCurrencyOf(organizationId: string): Promise<string> {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { baseCurrency: true, currency: true }
  })
  if (!organization) throw createError('Organization not found', 404)
  return (organization.baseCurrency || organization.currency || 'USD').toUpperCase()
}

async function currencyScope(organizationId: string): Promise<Prisma.CurrencyWhereInput> {
  return { OR: [{ organizationId }, { organizationId: null }] }
}

export async function resolveCurrency(organizationId: string, code: string) {
  const currency = await prisma.currency.findFirst({
    where: { code, ...(await currencyScope(organizationId)) },
    orderBy: [{ organizationId: 'desc' }, { createdAt: 'asc' }]
  })
  if (!currency) throw createError(`Currency ${code} is not configured for this organization`, 404)
  return currency
}

export async function upsertCurrencyRecord(
  tx: Prisma.TransactionClient,
  organizationId: string,
  code: string,
  data: { name?: string; symbol?: string; decimals?: number; isEnabled?: boolean }
) {
  const existing = await tx.currency.findFirst({
    where: { code, OR: [{ organizationId }, { organizationId: null }] },
    orderBy: [{ organizationId: 'desc' }, { createdAt: 'asc' }]
  })
  const payload = {
    name: data.name ?? existing?.name ?? code,
    symbol: data.symbol ?? existing?.symbol ?? code,
    decimals: data.decimals ?? existing?.decimals ?? 2,
    isEnabled: data.isEnabled ?? existing?.isEnabled ?? true
  }
  if (existing && existing.organizationId === organizationId) {
    return tx.currency.update({ where: { id: existing.id }, data: payload })
  }
  if (existing && existing.organizationId == null) {
    return tx.currency.create({ data: { organizationId, code, ...payload } })
  }
  return tx.currency.create({ data: { organizationId, code, ...payload } })
}

function latestRateMap(rates: Array<{ fromCurrencyId: string; toCurrencyId: string; rate: Prisma.Decimal; effectiveAt: Date }>) {
  const map = new Map<string, { rate: string; effectiveAt: Date }>()
  for (const row of rates) {
    const key = `${row.fromCurrencyId}:${row.toCurrencyId}`
    const current = map.get(key)
    if (!current || row.effectiveAt > current.effectiveAt) {
      map.set(key, { rate: row.rate.toFixed(8), effectiveAt: row.effectiveAt })
    }
  }
  return map
}

export async function listExchangeRatesForOrg(organizationId: string) {
  const baseCurrency = await baseCurrencyOf(organizationId)
  const currencies = await prisma.currency.findMany({
    where: await currencyScope(organizationId),
    orderBy: [{ isEnabled: 'desc' }, { code: 'asc' }]
  })
  const rates = await prisma.exchangeRate.findMany({
    where: {
      organizationId,
      fromCurrency: { OR: [{ organizationId }, { organizationId: null }] },
      toCurrency: { OR: [{ organizationId }, { organizationId: null }] }
    },
    include: {
      fromCurrency: { select: { id: true, code: true } },
      toCurrency: { select: { id: true, code: true } }
    },
    orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }]
  })
  const latest = latestRateMap(rates.map((r) => ({ fromCurrencyId: r.fromCurrencyId, toCurrencyId: r.toCurrencyId, rate: r.rate, effectiveAt: r.effectiveAt })))
  const byCode = new Map(currencies.map((c) => [c.code.toUpperCase(), c]))
  const base = byCode.get(baseCurrency)
  const enriched = currencies.map((currency) => {
    const code = currency.code.toUpperCase()
    const toBase = base ? latest.get(`${currency.id}:${base.id}`) : undefined
    const fromBase = base ? latest.get(`${base.id}:${currency.id}`) : undefined
    return {
      ...currency,
      code,
      isBaseCurrency: code === baseCurrency,
      toBaseRate: code === baseCurrency ? '1.00000000' : toBase?.rate ?? null,
      toBaseEffectiveAt: code === baseCurrency ? null : toBase?.effectiveAt ?? null,
      fromBaseRate: code === baseCurrency ? '1.00000000' : fromBase?.rate ?? null,
      fromBaseEffectiveAt: code === baseCurrency ? null : fromBase?.effectiveAt ?? null
    }
  })
  return { baseCurrency, currencies: enriched, rates }
}

export async function convertAmountForOrg(
  organizationId: string,
  amount: string,
  currency: string,
  baseCurrency: string
): Promise<{ converted: boolean; baseAmount?: string; exchangeRate?: string; reason?: string }> {
  const normalized = currency.toUpperCase()
  const base = baseCurrency.toUpperCase()
  if (normalized === base) {
    return { converted: true, baseAmount: new Prisma.Decimal(amount).toFixed(2), exchangeRate: '1.00000000' }
  }
  const from = await prisma.currency.findFirst({ where: { code: normalized, ...(await currencyScope(organizationId)) }, orderBy: [{ organizationId: 'desc' }] })
  const to = await prisma.currency.findFirst({ where: { code: base, ...(await currencyScope(organizationId)) }, orderBy: [{ organizationId: 'desc' }] })
  if (!from || !to) return { converted: false, reason: 'missing_currency' }
  const rate = await prisma.exchangeRate.findFirst({
    where: { organizationId, fromCurrencyId: from.id, toCurrencyId: to.id },
    orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }]
  })
  if (!rate) return { converted: false, reason: 'missing_rate' }
  return {
    converted: true,
    baseAmount: new Prisma.Decimal(amount).times(rate.rate).toDecimalPlaces(2).toFixed(2),
    exchangeRate: rate.rate.toFixed(8)
  }
}

export async function summarizeCurrencyAmounts(
  organizationId: string,
  rows: Array<{ currency: string; amount: string }>
) {
  const baseCurrency = await baseCurrencyOf(organizationId)
  const byCurrency = new Map<string, Prisma.Decimal>()
  for (const row of rows) {
    const code = (row.currency || 'UNSPECIFIED').toUpperCase()
    byCurrency.set(code, (byCurrency.get(code) || new Prisma.Decimal(0)).plus(new Prisma.Decimal(row.amount || '0')))
  }
  const breakdown = Array.from(byCurrency.entries())
    .map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
  let convertedTotal = new Prisma.Decimal(0)
  const missingCurrencies: string[] = []
  let hasConvertible = false
  for (const row of breakdown) {
    const result = await convertAmountForOrg(organizationId, row.amount, row.currency, baseCurrency)
    if (result.converted && result.baseAmount) {
      convertedTotal = convertedTotal.plus(result.baseAmount)
      hasConvertible = true
    } else {
      missingCurrencies.push(row.currency)
    }
  }
  return {
    baseCurrency,
    breakdown,
    convertedTotal: hasConvertible ? convertedTotal.toFixed(2) : null,
    missingCurrencies: Array.from(new Set(missingCurrencies)).sort(),
    hasRates: hasConvertible
  }
}
