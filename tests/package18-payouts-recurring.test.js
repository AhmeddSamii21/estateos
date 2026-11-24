const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const bcrypt = require('bcrypt')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.NODE_ENV = 'test'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')
const { runReminders } = require('../dist-backend/services/reminders.js')
const {
  addRecurrenceMonths,
  initialRecurrenceDue,
  parseRecurrenceInterval
} = require('../dist-backend/utils/recurringMaintenance.js')

const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG18-${runId}`
const DAY = 86_400_000
const state = {
  orgAId: null,
  orgBId: null,
  propertyId: null,
  ownerId: null,
  users: {},
  tokens: {}
}
let server
let baseUrl

async function api(method, path, options = {}) {
  const headers = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : null }
}

async function createOrg(suffix) {
  const org = await prisma.organization.create({
    data: {
      name: `${tag} ${suffix}`,
      slug: `${tag.toLowerCase()}-${suffix.toLowerCase()}`,
      currency: 'USD',
      baseCurrency: 'USD'
    },
    select: { id: true }
  })
  return org.id
}

async function createUser(key, organizationId, role) {
  const password = `Package18!${crypto.randomBytes(10).toString('base64url')}`
  const user = await prisma.user.create({
    data: {
      email: `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`,
      password: await bcrypt.hash(password, 10),
      role,
      organizationId,
      firstName: `Package ${key}`,
      isActive: true
    },
    select: { id: true, email: true }
  })
  state.users[key] = user
  const login = await api('POST', '/api/auth/login', { body: { email: user.email, password } })
  assert.equal(login.status, 200, `${key} login should succeed`)
  state.tokens[key] = login.data.data.token
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  state.orgAId = await createOrg('a')
  state.orgBId = await createOrg('b')
  await createUser('ADMIN_A', state.orgAId, 'ADMIN')
  await createUser('AGENT_A', state.orgAId, 'AGENT')
  await createUser('ADMIN_B', state.orgBId, 'ADMIN')
  const property = await prisma.property.create({
    data: {
      referenceNumber: `${tag}-PROPERTY`,
      title: 'Recurring property',
      type: 'APARTMENT',
      organizationId: state.orgAId
    },
    select: { id: true }
  })
  state.propertyId = property.id
  const owner = await prisma.owner.create({
    data: { organizationId: state.orgAId, firstName: 'Payout', lastName: 'Owner', isActive: true },
    select: { id: true }
  })
  state.ownerId = owner.id
})

test.after(async () => {
  try {
    const orgIds = [state.orgAId, state.orgBId].filter(Boolean)
    if (orgIds.length) {
      const users = await prisma.user.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } })
      const userIds = users.map((user) => user.id)
      await prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({
          where: { OR: [{ userId: { in: userIds } }, { organizationId: { in: orgIds } }] }
        })
        await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })
        await tx.ownerPayout.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.expense.deleteMany({ where: { property: { organizationId: { in: orgIds } } } })
        await tx.maintenanceRequest.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.owner.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.property.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } })
      })
    }
  } finally {
    await shutdown()
  }
})

test('recurrence helpers add calendar months and keep legacy rows inactive', () => {
  assert.equal(parseRecurrenceInterval(undefined), 'NONE')
  assert.equal(parseRecurrenceInterval('MONTHLY'), 'MONTHLY')
  assert.throws(() => parseRecurrenceInterval('WEEKLY'))

  const january = new Date('2026-01-31T10:30:00.000Z')
  assert.equal(addRecurrenceMonths(january, 'NONE'), null)
  assert.equal(addRecurrenceMonths(january, 'MONTHLY').toISOString(), '2026-02-28T10:30:00.000Z')
  assert.equal(addRecurrenceMonths(january, 'QUARTERLY').toISOString(), '2026-04-30T10:30:00.000Z')
  assert.equal(addRecurrenceMonths(january, 'SEMI_ANNUAL').toISOString(), '2026-07-31T10:30:00.000Z')
  assert.equal(initialRecurrenceDue('NONE', january), null)
  assert.equal(initialRecurrenceDue('MONTHLY', january).toISOString(), january.toISOString())
  assert.equal(initialRecurrenceDue('MONTHLY', null, january).toISOString(), '2026-02-28T10:30:00.000Z')
})

test('owner payouts are tenant scoped, audited and can be settled', async () => {
  const created = await api('POST', `/api/owners/${state.ownerId}/payouts`, {
    token: state.tokens.ADMIN_A,
    body: { amount: 1250.5, currency: 'usd', reference: `${tag}-PAYOUT`, periodStart: '2026-10-01', periodEnd: '2026-10-31' }
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  assert.equal(created.data.data.status, 'PENDING')
  assert.equal(created.data.data.currency, 'USD')
  const payoutId = created.data.data.id

  const listed = await api('GET', `/api/owners/${state.ownerId}/payouts`, { token: state.tokens.ADMIN_A })
  assert.equal(listed.status, 200, JSON.stringify(listed.data))
  assert.equal(listed.data.data.length, 1)
  assert.equal(listed.data.summary.pending, '1250.50')
  assert.equal(listed.data.summary.count, 1)

  const agentList = await api('GET', `/api/owners/${state.ownerId}/payouts`, { token: state.tokens.AGENT_A })
  assert.equal(agentList.status, 403)

  const crossTenant = await api('GET', `/api/owners/${state.ownerId}/payouts`, { token: state.tokens.ADMIN_B })
  assert.equal(crossTenant.status, 404)
  const crossTenantPatch = await api('PATCH', `/api/owners/${state.ownerId}/payouts/${payoutId}`, {
    token: state.tokens.ADMIN_B,
    body: { status: 'SETTLED' }
  })
  assert.equal(crossTenantPatch.status, 404)

  const forbidden = await api('POST', `/api/owners/${state.ownerId}/payouts`, {
    token: state.tokens.AGENT_A,
    body: { amount: 10 }
  })
  assert.equal(forbidden.status, 403)

  const invalid = await api('POST', `/api/owners/${state.ownerId}/payouts`, {
    token: state.tokens.ADMIN_A,
    body: { amount: 0 }
  })
  assert.equal(invalid.status, 400)

  const settled = await api('PATCH', `/api/owners/${state.ownerId}/payouts/${payoutId}`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'SETTLED' }
  })
  assert.equal(settled.status, 200, JSON.stringify(settled.data))
  assert.equal(settled.data.data.status, 'SETTLED')
  assert.ok(settled.data.data.settledAt)

  const after = await api('GET', `/api/owners/${state.ownerId}/payouts?status=SETTLED`, { token: state.tokens.ADMIN_A })
  assert.equal(after.status, 200)
  assert.equal(after.data.summary.settled, '1250.50')
  assert.equal(after.data.data.length, 1)

  const logs = await prisma.auditLog.findMany({
    where: { entityType: 'OwnerPayout', entityId: payoutId },
    select: { action: true },
    orderBy: { createdAt: 'asc' }
  })
  assert.deepEqual(logs.map((log) => log.action), ['OWNER_PAYOUT_CREATED', 'OWNER_PAYOUT_SETTLED'])
})

test('completing a recurring maintenance cycle opens the next dated cycle', async () => {
  const dueAt = new Date(Date.now() + 5 * DAY)
  const created = await api('POST', '/api/maintenance', {
    token: state.tokens.ADMIN_A,
    body: {
      propertyId: state.propertyId,
      title: `${tag} recurring HVAC`,
      priority: 'MEDIUM',
      status: 'OPEN',
      dueAt: dueAt.toISOString(),
      recurrenceInterval: 'MONTHLY'
    }
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  assert.equal(created.data.data.recurrenceInterval, 'MONTHLY')
  assert.equal(new Date(created.data.data.nextDueAt).toISOString(), dueAt.toISOString())
  const id = created.data.data.id

  const invalidTransition = await api('PATCH', `/api/maintenance/${id}`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'COMPLETED' }
  })
  assert.equal(invalidTransition.status, 400)

  const inProgress = await api('PATCH', `/api/maintenance/${id}`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'IN_PROGRESS' }
  })
  assert.equal(inProgress.status, 200, JSON.stringify(inProgress.data))

  const completed = await api('PATCH', `/api/maintenance/${id}`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'COMPLETED' }
  })
  assert.equal(completed.status, 200, JSON.stringify(completed.data))
  assert.ok(completed.data.data.recurringFollowUpId)

  const followUp = await prisma.maintenanceRequest.findUnique({
    where: { id: completed.data.data.recurringFollowUpId },
    select: { title: true, status: true, dueAt: true, nextDueAt: true, recurrenceInterval: true, recurrenceSourceId: true }
  })
  assert.ok(followUp)
  assert.equal(followUp.status, 'OPEN')
  assert.equal(followUp.recurrenceInterval, 'MONTHLY')
  assert.equal(followUp.recurrenceSourceId, id)
  const expected = new Date(Date.UTC(
    dueAt.getUTCFullYear(),
    dueAt.getUTCMonth() + 1,
    dueAt.getUTCDate(),
    dueAt.getUTCHours(),
    dueAt.getUTCMinutes(),
    dueAt.getUTCSeconds(),
    dueAt.getUTCMilliseconds()
  ))
  assert.equal(followUp.dueAt.toISOString(), expected.toISOString())
  assert.equal(followUp.nextDueAt.toISOString(), expected.toISOString())

  const recurrenceLog = await prisma.auditLog.findFirst({
    where: { action: 'MAINTENANCE_RECURRENCE_CREATED', entityId: followUp ? completed.data.data.recurringFollowUpId : '' },
    select: { details: true }
  })
  assert.ok(recurrenceLog)
  assert.equal(JSON.parse(recurrenceLog.details).sourceId, id)
})

test('recurring maintenance reminders are deduplicated per request and day', async () => {
  const past = new Date(Date.now() - 3 * DAY)
  const created = await api('POST', '/api/maintenance', {
    token: state.tokens.ADMIN_A,
    body: {
      propertyId: state.propertyId,
      title: `${tag} overdue recurring`,
      status: 'OPEN',
      dueAt: past.toISOString(),
      recurrenceInterval: 'MONTHLY'
    }
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const id = created.data.data.id

  const first = await runReminders(new Date(), { organizationIds: [state.orgAId] })
  const second = await runReminders(new Date(), { organizationIds: [state.orgAId] })
  assert.ok(first.maintenanceReminders >= 1, JSON.stringify(first))
  assert.equal(second.maintenanceReminders, 0, JSON.stringify(second))

  const notifications = await prisma.notification.findMany({
    where: { entityType: 'MaintenanceRequest', entityId: id },
    select: { type: true, metadata: true }
  })
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].type, 'MAINTENANCE_RECURRING_OVERDUE_REMINDER')
  const metadata = typeof notifications[0].metadata === 'string'
    ? JSON.parse(notifications[0].metadata)
    : notifications[0].metadata
  assert.equal(metadata.kind, 'overdue')
})
