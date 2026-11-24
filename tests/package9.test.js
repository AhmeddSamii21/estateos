const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

process.env.NODE_ENV = 'test'

const maintenance = require('../dist-backend/utils/maintenanceExpense.js')
const metrics = require('../dist-backend/utils/reportMetrics.js')
const board = require('../dist-backend/utils/propertyBoard.js')

// ---------------------------------------------------------------------------
// Part 1 — completed maintenance creates one linked expense
// ---------------------------------------------------------------------------

test('Part 1: only completed positive-cost maintenance records an expense', () => {
  assert.equal(maintenance.shouldRecordMaintenanceExpense({ status: 'COMPLETED', cost: '120.50' }), true)
  assert.equal(maintenance.shouldRecordMaintenanceExpense({ status: 'IN_PROGRESS', cost: '120.50' }), false)
  assert.equal(maintenance.shouldRecordMaintenanceExpense({ status: 'COMPLETED', cost: 0 }), false)
  assert.equal(maintenance.shouldRecordMaintenanceExpense({ status: 'COMPLETED', cost: '-1' }), false)
  assert.equal(maintenance.shouldRecordMaintenanceExpense({ status: 'COMPLETED', cost: '50', recordExpense: false }), false)
  assert.equal(maintenance.shouldRecordMaintenanceExpense({ status: 'COMPLETED', cost: '50', recordExpense: 'false' }), false)
  assert.equal(maintenance.shouldRecordMaintenanceExpense({ status: 'COMPLETED', cost: '50', linkedExpenseId: 'exp-1' }), false)
})

test('Part 1: expense payload links the maintenance request and validates currency', () => {
  const data = maintenance.maintenanceExpenseData({
    id: 'mnt-1',
    propertyId: 'prop-1',
    title: 'Fix leak',
    cost: '120.5',
    currency: 'eur',
    completedAt: new Date('2026-05-01T10:00:00.000Z'),
    assignedToId: 'user-1'
  })
  assert.equal(data.amount, '120.50')
  assert.equal(data.currency, 'EUR')
  assert.equal(data.status, 'PAID')
  assert.equal(data.category, 'MAINTENANCE')
  assert.deepEqual(data.property, { connect: { id: 'prop-1' } })
  assert.deepEqual(data.maintenanceRequest, { connect: { id: 'mnt-1' } })
  assert.deepEqual(data.responsible, { connect: { id: 'user-1' } })
  assert.match(data.notes, /MAINTENANCE-mnt-1/)
  assert.equal(maintenance.maintenanceExpenseKey('mnt-1'), 'MAINTENANCE-mnt-1')
  assert.deepEqual(maintenance.maintenanceExpenseWhere('mnt-1'), { maintenanceRequestId: 'mnt-1', deletedAt: null })
  assert.throws(() => maintenance.normalizeMaintenanceCurrency('EURO'), /3-letter/)
})

test('Part 1: linked expense summary is null-safe', () => {
  assert.deepEqual(maintenance.linkedExpenseSummary(null), {
    linkedExpenseId: null,
    linkedExpenseStatus: null,
    linkedExpenseAmount: null,
    linkedExpenseCurrency: null
  })
  assert.deepEqual(maintenance.linkedExpenseSummary({ id: 'e1', status: 'PAID', amount: '20.00', currency: 'USD' }), {
    linkedExpenseId: 'e1',
    linkedExpenseStatus: 'PAID',
    linkedExpenseAmount: '20.00',
    linkedExpenseCurrency: 'USD'
  })
})

// ---------------------------------------------------------------------------
// Part 2 — funnel conversion and uncontacted-lead SLA metrics
// ---------------------------------------------------------------------------

test('Part 2: funnel stages and conversion rates follow the required path', () => {
  const funnel = metrics.buildFunnelMetrics({
    leadCounts: { NEW: 10, CONTACTED: 5, QUALIFIED: 3, VIEWING: 4, WON: 2, LOST: 1 },
    dealCounts: { COMPLETED: 1, ACTIVE: 3, CANCELLED: 2 }
  })
  assert.equal(funnel.leads.total, 25)
  assert.equal(funnel.leads.new, 10)
  assert.equal(funnel.leads.engaged, 8)
  assert.equal(funnel.leads.viewing, 4)
  assert.equal(funnel.leads.won, 2)
  assert.equal(funnel.deals.closed, 1)
  assert.deepEqual(funnel.conversionRates, {
    newToEngaged: 0.8,
    engagedToViewing: 0.5,
    viewingToWon: 0.5,
    leadToClosedDeal: 0.04
  })
  assert.deepEqual(funnel.stages.map((stage) => stage.stage), ['new', 'engaged', 'viewing', 'won', 'closedDeals'])
  assert.equal(funnel.stages[3].conversionRate, 0.5)
})

test('Part 2: zero denominators never produce NaN', () => {
  const funnel = metrics.buildFunnelMetrics({ leadCounts: {}, dealCounts: {} })
  assert.equal(funnel.conversionRates.newToEngaged, 0)
  assert.equal(funnel.stages[4].conversionRate, 0)
  assert.equal(metrics.conversionRate(1, 0), 0)
})

test('Part 2: SLA query selects NEW, never-contacted leads older than 24 hours', () => {
  const where = metrics.uncontactedLeadWhere('org-1', { now: new Date('2026-05-02T12:00:00.000Z') })
  assert.equal(where.status, 'NEW')
  assert.equal(where.lastContactedAt, null)
  assert.deepEqual(where.createdAt, { lt: new Date('2026-05-01T12:00:00.000Z') })
  assert.ok(Array.isArray(where.AND))
  assert.deepEqual(metrics.uncontactedLeadWhere('org-1', { now: new Date('2026-05-02T12:00:00.000Z'), hours: 48 }).createdAt, {
    lt: new Date('2026-04-30T12:00:00.000Z')
  })
})

test('Part 2: SLA CSV escapes cells and reminder keys are stable', () => {
  const csv = metrics.uncontactedLeadCsv([{
    id: 'lead-1',
    firstName: 'Sara, "Al"',
    lastName: 'Ali',
    email: 'sara@example.com',
    phone: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    assignedTo: { email: 'agent@example.com' }
  }], new Date('2026-05-02T10:00:00.000Z'))
  assert.match(csv, /leadId,name,email,phone,createdAt,ageHours,assignedTo/)
  assert.match(csv, /"Sara, ""Al"" Ali"/)
  assert.match(csv, /,24,agent@example\.com/)
  assert.equal(
    metrics.uncontactedReminderKey('u1', 'org-1', 'lead-1', '2026-05-02'),
    'u1|org-1|NEW_LEAD_UNCONTACTED|Lead|lead-1|2026-05-02'
  )
})

// ---------------------------------------------------------------------------
// Part 3 — property status board
// ---------------------------------------------------------------------------

test('Part 3: board groups only the five supported columns', () => {
  assert.deepEqual([...board.BOARD_STATUSES], ['AVAILABLE', 'RESERVED', 'SOLD', 'RENTED', 'OFF_MARKET'])
  const rows = [
    { id: 'a', status: 'AVAILABLE' },
    { id: 'r', status: 'RESERVED' },
    { id: 's', status: 'SOLD' },
    { id: 'x', status: 'PENDING' }
  ]
  const grouped = board.groupByBoardStatus(rows)
  assert.deepEqual(grouped.AVAILABLE.map((row) => row.id), ['a'])
  assert.deepEqual(grouped.RESERVED.map((row) => row.id), ['r'])
  assert.deepEqual(grouped.SOLD.map((row) => row.id), ['s'])
  assert.deepEqual(grouped.RENTED, [])
  assert.deepEqual(grouped.OFF_MARKET, [])
})

test('Part 3: quick transitions reuse canonical property rules', () => {
  assert.doesNotThrow(() => board.assertBoardTransition('AVAILABLE', 'RESERVED'))
  assert.doesNotThrow(() => board.assertBoardTransition('RESERVED', 'SOLD'))
  assert.throws(() => board.assertBoardTransition('SOLD', 'AVAILABLE'), /Invalid property status transition/)
  assert.throws(() => board.assertBoardTransition('AVAILABLE', 'PENDING'), /Unsupported board status/)
  assert.ok(board.boardQuickTransitions('AVAILABLE').includes('SOLD'))
  assert.deepEqual(board.boardQuickTransitions('SOLD'), [])
})

// ---------------------------------------------------------------------------
// Wiring checks
// ---------------------------------------------------------------------------

test('Package 9: schema, routes and views are wired', () => {
  const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
  const schema = read('prisma/schema.prisma')
  const maintenanceRoute = read('backend/routes/maintenance.ts')
  const reportsRoute = read('backend/routes/reports.ts')
  const reminders = read('backend/services/reminders.ts')
  const propertiesRoute = read('backend/routes/properties.ts')
  const reportsView = read('frontend/src/views/ReportsView.vue')
  const resourceView = read('frontend/src/views/ResourceView.vue')
  const propertyList = read('frontend/src/views/PropertyList.vue')

  assert.match(schema, /model Expense \{[\s\S]*?maintenanceRequestId\s+String\?\s+@unique/)
  assert.match(maintenanceRoute, /maintenanceExpenseData/)
  assert.match(maintenanceRoute, /linkedExpenseSummary/)
  assert.match(reportsRoute, /buildFunnelMetrics/)
  assert.match(reportsRoute, /uncontactedLeadWhere/)
  assert.match(reminders, /NEW_LEAD_UNCONTACTED/)
  assert.match(propertiesRoute, /get\('\/board'/)
  assert.match(propertyList, /Status Board/)
  assert.match(reportsView, /Funnel/)
  assert.match(reportsView, /SLA/)
  assert.match(resourceView, /Linked expense/)
})
