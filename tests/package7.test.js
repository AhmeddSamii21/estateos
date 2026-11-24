const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

process.env.NODE_ENV = 'test'

const { Prisma, Role } = require('@prisma/client')

const ownerStatement = require('../dist-backend/utils/ownerStatement.js')
const priceHistory = require('../dist-backend/utils/priceHistory.js')
const duplication = require('../dist-backend/utils/propertyDuplication.js')

const dec = (value) => new Prisma.Decimal(value)

// ---------------------------------------------------------------------------
// Part 1 — owner statement scoping and grouped financial data
// ---------------------------------------------------------------------------

test('Part 1: statement owner lookup reuses ownerReadScope and never leaves the organization', () => {
  assert.deepEqual(ownerStatement.ownerStatementOwnerWhere('org-1', 'owner-1'), {
    id: 'owner-1',
    OR: [
      { organizationId: 'org-1' },
      { organizationId: null, properties: { some: { organizationId: 'org-1', deletedAt: null } } }
    ],
    deletedAt: null
  })
  assert.deepEqual(ownerStatement.ownerStatementPropertyWhere('org-1', 'owner-1'), {
    ownerId: 'owner-1', organizationId: 'org-1', deletedAt: null
  })
  assert.deepEqual(ownerStatement.ownerStatementDealWhere('org-1', ['p1']), {
    organizationId: 'org-1', propertyId: { in: ['p1'] }, deletedAt: null
  })
  assert.deepEqual(ownerStatement.ownerStatementPaymentWhere(['d1']), {
    dealId: { in: ['d1'] }, status: 'COMPLETED', deletedAt: null
  })
  assert.deepEqual(ownerStatement.ownerStatementExpenseWhere(['p1']), {
    propertyId: { in: ['p1'] }, status: 'PAID', deletedAt: null
  })
})

test('Part 1: only finance roles receive monetary owner statement figures', () => {
  assert.equal(ownerStatement.canViewOwnerFinancials(Role.ADMIN), true)
  assert.equal(ownerStatement.canViewOwnerFinancials(Role.MANAGER), true)
  assert.equal(ownerStatement.canViewOwnerFinancials(Role.ACCOUNTANT), true)
  assert.equal(ownerStatement.canViewOwnerFinancials(Role.AGENT), false)
  assert.equal(ownerStatement.canViewOwnerFinancials(undefined), false)
})

const statementRows = {
  properties: [
    { id: 'p1', title: 'Flat', referenceNumber: 'P1', status: 'AVAILABLE', city: 'Cairo', price: dec('100000.00'), currency: 'USD', isActive: true },
    { id: 'p2', title: 'Villa', referenceNumber: 'P2', status: 'SOLD', city: 'Alex', price: dec('90000.00'), currency: 'EUR', isActive: false }
  ],
  deals: [
    { id: 'd1', status: 'COMPLETED', type: 'SALE', amount: dec('95000.00'), currency: 'USD' },
    { id: 'd2', status: 'ACTIVE', type: 'RENT', amount: dec('2000.00'), currency: 'EUR' }
  ],
  payments: [
    { id: 'pay1', status: 'COMPLETED', amount: dec('40000.00'), currency: 'USD' },
    { id: 'pay2', status: 'COMPLETED', amount: dec('1000.00'), currency: 'eur' }
  ],
  expenses: [
    { id: 'e1', status: 'PAID', amount: dec('500.00'), currency: 'USD' },
    { id: 'e2', status: 'PAID', amount: dec('250.00'), currency: 'EUR' }
  ]
}

test('Part 1: statement groups properties, deals, collected payments and expenses by currency', () => {
  const statement = ownerStatement.buildOwnerStatement(
    { id: 'owner-1', displayName: 'Acme, "Ltd"' },
    statementRows,
    { includeFinancials: true, generatedAt: new Date('2026-07-01T00:00:00.000Z') }
  )

  assert.equal(statement.properties.count, 2)
  assert.equal(statement.properties.activeCount, 1)
  assert.deepEqual(statement.properties.byStatus, { AVAILABLE: 1, SOLD: 1 })
  assert.deepEqual(statement.deals.byType, { SALE: 1, RENT: 1 })
  assert.equal(statement.financialsRestricted, false)
  assert.deepEqual(statement.financials.currencies.map((row) => row.currency), ['EUR', 'USD'])

  const euro = statement.financials.currencies[0]
  assert.deepEqual(euro, {
    currency: 'EUR',
    properties: { count: 1, listedValue: '90000.00' },
    deals: { count: 1, amount: '2000.00' },
    payments: { count: 1, collected: '1000.00' },
    expenses: { count: 1, paid: '250.00' },
    net: '750.00'
  })
  const dollar = statement.financials.currencies[1]
  assert.equal(dollar.properties.listedValue, '100000.00')
  assert.equal(dollar.deals.amount, '95000.00')
  assert.equal(dollar.payments.collected, '40000.00')
  assert.equal(dollar.expenses.paid, '500.00')
  assert.equal(dollar.net, '39500.00')
  assert.equal(statement.properties.list[0].price, statementRows.properties[0].price)
})

test('Part 1: restricted statements omit monetary fields and CSV never leaks them', () => {
  const restricted = ownerStatement.buildOwnerStatement(
    { id: 'owner-1', displayName: 'Acme' }, statementRows, { includeFinancials: false }
  )
  assert.equal(restricted.financialsRestricted, true)
  assert.equal(restricted.financials, undefined)
  assert.equal('price' in restricted.properties.list[0], false)
  assert.equal('currency' in restricted.properties.list[0], false)

  const full = ownerStatement.buildOwnerStatement(
    { id: 'owner-1', displayName: 'Acme, "Ltd"' }, statementRows, { includeFinancials: true }
  )
  const fullCsv = ownerStatement.ownerStatementCsv(full)
  assert.match(fullCsv, /Financials,Collected payments,USD,40000\.00/)
  assert.match(fullCsv, /"Acme, ""Ltd"""/)
  const restrictedCsv = ownerStatement.ownerStatementCsv(restricted)
  assert.doesNotMatch(restrictedCsv, /40000\.00|95000\.00|90000\.00/)
  assert.match(restrictedCsv, /Financials,Restricted,,Financial figures are available to finance roles only/)
})

// ---------------------------------------------------------------------------
// Part 2 — structured price history metadata
// ---------------------------------------------------------------------------

test('Part 2: price change metadata records explicit before/after price and currency', () => {
  const change = priceHistory.priceChangeMetadata(
    { price: dec('100.00'), currency: 'usd' },
    { price: '125.50', currency: 'USD' }
  )
  assert.deepEqual(change, {
    oldPrice: '100.00',
    oldCurrency: 'USD',
    newPrice: '125.50',
    newCurrency: 'USD',
    price: { before: '100.00', after: '125.50' },
    currency: { before: 'USD', after: 'USD' }
  })
  assert.equal(priceHistory.priceChangeMetadata(
    { price: dec('100.00'), currency: 'USD' },
    { price: '100.00', currency: 'usd' }
  ), null)
})

test('Part 2: currency-only edits are recorded and activity JSON is parsed safely', () => {
  const change = priceHistory.priceChangeMetadata(
    { price: dec('500.00'), currency: 'USD' },
    { price: '500', currency: 'EUR' }
  )
  assert.equal(change.oldPrice, '500.00')
  assert.equal(change.newPrice, '500.00')
  assert.equal(change.currency.before, 'USD')
  assert.equal(change.currency.after, 'EUR')

  const history = priceHistory.parsePriceHistory([
    {
      id: 'old', action: priceHistory.PROPERTY_PRICE_CHANGED, createdAt: new Date('2026-05-01T00:00:00.000Z'),
      details: JSON.stringify({ ...change, note: 'repricing' })
    },
    { id: 'unrelated', action: 'PROPERTY_UPDATED', createdAt: new Date('2026-06-01T00:00:00.000Z'), details: null },
    {
      id: 'new', action: priceHistory.PROPERTY_PRICE_CHANGED, createdAt: new Date('2026-06-10T00:00:00.000Z'),
      details: '{not json'
    }
  ])
  // Malformed JSON and unrelated actions are skipped without throwing.
  assert.deepEqual(history.map((entry) => entry.id), ['old'])
  assert.equal(history[0].oldPrice, '500.00')
  assert.equal(history[0].newPrice, '500.00')
  assert.equal(history[0].oldCurrency, 'USD')
  assert.equal(history[0].newCurrency, 'EUR')
})

// ---------------------------------------------------------------------------
// Part 3 — duplicate/clone draft sanitization
// ---------------------------------------------------------------------------

test('Part 3: duplicate drafts keep listing content but strip identifiers, share links and internal data', () => {
  const source = {
    id: 'prop-1',
    referenceNumber: 'PROP-1',
    title: 'Sea View Flat',
    type: 'APARTMENT',
    classification: 'SALE',
    description: 'Bright sea view apartment',
    address: '1 Main St',
    city: 'Alexandria',
    state: 'Alexandria',
    country: 'EG',
    postalCode: '21500',
    latitude: dec('31.2000000'),
    longitude: dec('29.9000000'),
    area: dec('120.00'),
    areaUnit: 'SQ_M',
    bedrooms: 3,
    bathrooms: 2,
    floors: 4,
    yearBuilt: 2020,
    condition: 'EXCELLENT',
    occupancyStatus: 'VACANT',
    negotiable: true,
    price: dec('250000.00'),
    currency: 'USD',
    ownerId: 'owner-1',
    owner: { id: 'owner-1', email: 'private@example.test' },
    assignedAgentId: 'agent-1',
    organizationId: 'org-1',
    status: 'SOLD',
    publicShareToken: 'secret-share-token',
    publicShareEnabled: true,
    publicShareExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    isActive: true,
    operationalNotes: 'Internal broker note',
    saleRentRatio: dec('0.50'),
    reservedUntil: new Date('2026-02-01T00:00:00.000Z'),
    activities: [{ id: 'activity-1' }],
    deals: [{ id: 'deal-1' }],
    expenses: [{ id: 'expense-1' }],
    leads: [],
    appointments: [],
    maintenanceRequests: [],
    images: [],
    _count: { deals: 1 }
  }

  const draft = duplication.buildDuplicateDraft(source)
  assert.equal('status' in draft, false, 'the source lifecycle status must be stripped')
  assert.equal(draft.title, 'Sea View Flat')
  assert.equal(draft.type, 'APARTMENT')
  assert.equal(draft.classification, 'SALE')
  assert.equal(draft.description, 'Bright sea view apartment')
  assert.equal(draft.ownerId, 'owner-1')
  assert.equal(Number(draft.latitude), 31.2)
  assert.equal(Number(draft.longitude), 29.9)
  assert.equal(draft.bedrooms, 3)
  assert.equal(draft.condition, 'EXCELLENT')
  assert.equal(draft.negotiable, true)
  assert.equal(draft.price, source.price.toString())

  for (const field of duplication.DUPLICATE_STRIPPED_FIELDS) {
    assert.equal(field in draft, false, `${field} must not be copied`)
  }
  assert.equal('id' in draft, false)
  assert.equal('referenceNumber' in draft, false)
  assert.equal('publicShareToken' in draft, false)

  for (const field of ['type', 'city', 'latitude', 'longitude', 'bedrooms', 'bathrooms', 'floors', 'area', 'condition', 'ownerId', 'description']) {
    assert.ok(duplication.DUPLICATE_DRAFT_FIELDS.includes(field), `${field} should be prefilled`)
  }
})

// ---------------------------------------------------------------------------
// UI wiring checks (the Vue SFCs are not executed by Node tests)
// ---------------------------------------------------------------------------

test('Package 7: API endpoints and UI actions are wired to the new helpers', () => {
  const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
  const ownersRoute = read('backend/routes/owners.ts')
  const propertiesRoute = read('backend/routes/properties.ts')
  const ownersView = read('frontend/src/views/OwnersView.vue')
  const detailView = read('frontend/src/views/PropertyDetail.vue')
  const formView = read('frontend/src/views/PropertyForm.vue')
  const timeline = read('frontend/src/components/ActivityTimeline.vue')

  assert.match(ownersRoute, /router\.get\('\/:id\/statement'/)
  assert.match(ownersRoute, /ownerStatementOwnerWhere/)
  assert.match(ownersRoute, /canViewOwnerFinancials/)
  assert.match(propertiesRoute, /router\.get\('\/:id\/duplicate-draft'/)
  assert.match(propertiesRoute, /PROPERTY_PRICE_CHANGED/)
  assert.match(detailView, /Duplicate Property/)
  assert.match(detailView, /Price History/)
  assert.match(detailView, /duplicate-draft/)
  assert.match(formView, /DUPLICATE_QUERY_FLAG/)
  assert.match(formView, /status: 'AVAILABLE'/)
  assert.match(ownersView, /\/owners\/\$\{row\.id\}\/statement/)
  assert.match(ownersView, /ownerStatementCsv/)
  assert.match(ownersView, /Export CSV/)
  assert.match(timeline, /PROPERTY_PRICE_CHANGED/)
  assert.match(timeline, /Property price changed/)
})
