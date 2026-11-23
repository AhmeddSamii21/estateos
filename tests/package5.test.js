const test = require('node:test')
const assert = require('node:assert/strict')

process.env.NODE_ENV = 'test'

// Package 5 helpers are pure or DB-backed via the shared prisma module. Stub
// that module so these unit tests run without a live database.
const { Prisma } = require('@prisma/client')
const prismaModulePath = require.resolve('../dist-backend/prisma.js')
const currencies = [
  { id: 'usd', code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2, isEnabled: true, organizationId: 'org' },
  { id: 'eur', code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, isEnabled: true, organizationId: 'org' }
]
const rateRows = [{
  fromCurrencyId: 'eur',
  toCurrencyId: 'usd',
  rate: new Prisma.Decimal('1.20000000'),
  effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  fromCurrency: { id: 'eur', code: 'EUR' },
  toCurrency: { id: 'usd', code: 'USD' }
}]
const fakePrisma = {
  organization: {
    findFirst: async () => ({ baseCurrency: 'USD', currency: 'USD' }),
    findMany: async () => []
  },
  currency: {
    findMany: async () => currencies,
    findFirst: async ({ where }) => currencies.find((currency) => currency.code === where.code) || null
  },
  exchangeRate: {
    findMany: async () => rateRows,
    findFirst: async ({ where }) => rateRows.find((row) =>
      row.fromCurrencyId === where.fromCurrencyId && row.toCurrencyId === where.toCurrencyId) || null
  },
  notification: { findFirst: async () => null }
}
require.cache[prismaModulePath] = {
  id: prismaModulePath,
  filename: prismaModulePath,
  loaded: true,
  exports: { prisma: fakePrisma }
}

const fx = require('../dist-backend/utils/fx.js')
const share = require('../dist-backend/utils/share.js')
const reminders = require('../dist-backend/services/reminders.js')

test('Part 1: FX currency codes are normalized to 3-letter ISO codes', () => {
  assert.equal(fx.normalizeCurrencyCode(' eur ', 'code'), 'EUR')
  assert.throws(() => fx.normalizeCurrencyCode('EURO', 'code'), /3-letter ISO/)
  assert.throws(() => fx.normalizeCurrencyCode('12', 'code'), /3-letter ISO/)
})

test('Part 1: managed exchange rates convert to the organization base currency', async () => {
  assert.deepEqual(await fx.convertAmountForOrg('org', '100.00', 'USD', 'USD'), {
    converted: true,
    baseAmount: '100.00',
    exchangeRate: '1.00000000'
  })
  assert.deepEqual(await fx.convertAmountForOrg('org', '100.00', 'EUR', 'USD'), {
    converted: true,
    baseAmount: '120.00',
    exchangeRate: '1.20000000'
  })
  const missing = await fx.convertAmountForOrg('org', '100.00', 'GBP', 'USD')
  assert.equal(missing.converted, false)
  assert.equal(missing.reason, 'missing_currency')
})

test('Part 1: per-currency breakdown keeps source amounts and adds a base total', async () => {
  const summary = await fx.summarizeCurrencyAmounts('org', [
    { currency: 'USD', amount: '25.00' },
    { currency: 'EUR', amount: '100.00' },
    { currency: 'USD', amount: '5.00' }
  ])
  assert.equal(summary.baseCurrency, 'USD')
  assert.deepEqual(summary.breakdown, [
    { currency: 'EUR', amount: '100.00' },
    { currency: 'USD', amount: '30.00' }
  ])
  assert.equal(summary.convertedTotal, '150.00')
  assert.deepEqual(summary.missingCurrencies, [])
})

test('Part 1: exchange rate overview exposes latest rate to base currency', async () => {
  const overview = await fx.listExchangeRatesForOrg('org')
  assert.equal(overview.baseCurrency, 'USD')
  const eur = overview.currencies.find((currency) => currency.code === 'EUR')
  assert.equal(eur.isBaseCurrency, false)
  assert.equal(eur.toBaseRate, '1.20000000')
  assert.equal(overview.currencies.find((currency) => currency.code === 'USD').isBaseCurrency, true)
})

test('Part 2: share tokens are validated and URLs honor configured origins', () => {
  assert.equal(share.isValidShareToken('a'.repeat(32)), true)
  assert.equal(share.isValidShareToken('short'), false)
  assert.equal(share.isValidShareToken('bad token with spaces'), false)
  assert.equal(share.publicSharePath('abc'), '/p/abc')
  assert.equal(share.buildPublicShareUrl('abc'), '/p/abc')
  assert.equal(share.buildPublicShareUrl('abc', { origin: 'http://localhost:5173/' }), 'http://localhost:5173/p/abc')
  assert.equal(share.buildPublicShareUrl('abc', { publicAppUrl: 'https://estate.example/', origin: 'http://ignored' }), 'https://estate.example/p/abc')
})

test('Part 2: expired share links are rejected at the expiry instant', () => {
  const now = new Date('2026-06-01T00:00:00.000Z')
  assert.equal(share.isShareExpired(null, now), false)
  assert.equal(share.isShareExpired(new Date('2026-06-02T00:00:00.000Z'), now), false)
  assert.equal(share.isShareExpired(now, now), true)
  assert.equal(share.isShareExpired(new Date('2026-05-31T00:00:00.000Z'), now), true)
})

test('Part 3: reminder day keys and overdue classification are UTC-stable', () => {
  assert.equal(reminders.toDayKey(new Date('2026-06-01T23:59:59.000Z')), '2026-06-01')
  const now = new Date('2026-06-01T10:00:00.000Z')
  assert.equal(reminders.isOverdue(new Date('2026-05-31T23:00:00.000Z'), now), true)
  assert.equal(reminders.isOverdue(new Date('2026-06-01T09:00:00.000Z'), now), false)
  assert.equal(reminders.isOverdue(new Date('2026-06-02T09:00:00.000Z'), now), false)
})

test('Part 3: reminder run reports zero work when there are no active organizations', async () => {
  const result = await reminders.runReminders(new Date('2026-06-01T10:00:00.000Z'))
  assert.deepEqual(result, { organizations: 0, paymentReminders: 0, appointmentReminders: 0 })
})

test('Part 3: scheduler start and stop are safe during tests', () => {
  assert.doesNotThrow(() => reminders.startReminderScheduler())
  assert.doesNotThrow(() => reminders.stopReminderScheduler())
})
