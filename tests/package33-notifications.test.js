const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const bcrypt = require('bcrypt')

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')
const { runReminders } = require('../dist-backend/services/reminders.js')
const { resolveNotificationTarget } = require('../dist-backend/utils/notificationTargets.js')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG33-${runId}`
const state = {
  orgIds: [],
  userIds: [],
  tokens: {},
  propertyId: null,
  leadId: null,
  dealId: null,
  paymentId: null,
  appointmentId: null
}
let server
let baseUrl

async function api(method, requestPath, options = {}) {
  const headers = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : null }
}

async function createOrg(suffix) {
  const org = await prisma.organization.create({
    data: { name: `${tag} ${suffix}`, slug: `${tag.toLowerCase()}-${suffix}`, currency: 'USD', baseCurrency: 'USD' },
    select: { id: true }
  })
  state.orgIds.push(org.id)
  return org.id
}

async function createUser(key, organizationId, role) {
  const password = `Notify33!${crypto.randomBytes(8).toString('base64url')}`
  const email = `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`
  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 4),
      role,
      organizationId,
      firstName: `${tag} ${key}`,
      isActive: true,
      accountStatus: 'ACTIVE'
    },
    select: { id: true }
  })
  state.userIds.push(user.id)
  const login = await api('POST', '/api/auth/login', { body: { email, password } })
  assert.equal(login.status, 200, `${key} login failed: ${JSON.stringify(login.data)}`)
  state.tokens[key] = login.data.data.token
  return user.id
}

async function notificationsOf(key) {
  const response = await api('GET', '/api/notifications?limit=100', { token: state.tokens[key] })
  assert.equal(response.status, 200)
  return response.data.data
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const orgA = await createOrg('a')
  await createUser('ADMIN_A', orgA, 'ADMIN')
  await createUser('AGENT_A', orgA, 'AGENT')
  const orgB = await createOrg('b')
  await createUser('ADMIN_B', orgB, 'ADMIN')

  const property = await api('POST', '/api/properties', {
    token: state.tokens.ADMIN_A,
    body: {
      title: `${tag} Apartment`,
      type: 'APARTMENT',
      classification: 'SALE',
      city: 'Cairo',
      price: 250000,
      currency: 'EGP'
    }
  })
  assert.equal(property.status, 201, JSON.stringify(property.data))
  state.propertyId = property.data.data.id

  const lead = await api('POST', '/api/leads', {
    token: state.tokens.ADMIN_A,
    body: { firstName: `${tag} Lead`, source: 'Website', assignedToId: state.userIds[0] }
  })
  assert.equal(lead.status, 201, JSON.stringify(lead.data))
  state.leadId = lead.data.data.id

  const appointment = await api('POST', '/api/appointments', {
    token: state.tokens.ADMIN_A,
    body: {
      title: `${tag} Viewing`,
      startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      userId: state.userIds[1],
      propertyId: state.propertyId,
      leadId: state.leadId
    }
  })
  assert.equal(appointment.status, 201, JSON.stringify(appointment.data))
  state.appointmentId = appointment.data.data.id

  const deal = await prisma.deal.create({
    data: {
      referenceNumber: `${tag}-DEAL`,
      organizationId: orgA,
      propertyId: state.propertyId,
      leadId: state.leadId,
      userId: state.userIds[1],
      status: 'DRAFT',
      amount: 250000,
      currency: 'EGP',
      dueAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    },
    select: { id: true }
  })
  state.dealId = deal.id
  const payment = await prisma.payment.create({
    data: { dealId: deal.id, amount: 50000, currency: 'EGP', status: 'PENDING' },
    select: { id: true }
  })
  state.paymentId = payment.id
})

test.after(async () => {
  try {
    if (state.orgIds.length) {
      await prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.payment.deleteMany({ where: { dealId: state.dealId ? { in: [state.dealId] } : { in: [] } } })
        await tx.dealClosingChecklist.deleteMany({ where: { deal: { organizationId: { in: state.orgIds } } } })
        await tx.deal.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.appointment.deleteMany({ where: { OR: [{ propertyId: state.propertyId }, { userId: { in: state.userIds } }] } })
        await tx.leadNote.deleteMany({ where: { leadId: state.leadId ? { in: [state.leadId] } : { in: [] } } })
        await tx.lead.deleteMany({ where: { assignedTo: { organizationId: { in: state.orgIds } } } })
        await tx.property.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.auditLog.deleteMany({ where: { userId: { in: state.userIds } } })
        await tx.user.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.organization.deleteMany({ where: { id: { in: state.orgIds } } })
      })
    }
  } finally {
    await shutdown()
    if (server?.listening) await new Promise((resolve) => server.close(resolve))
  }
})

test('Package 33: lead reassignment raises an in-app assignment notification', async () => {
  const patch = await api('PATCH', `/api/leads/${state.leadId}`, {
    token: state.tokens.ADMIN_A,
    body: { assignedToId: state.userIds[1], status: 'CONTACTED' }
  })
  assert.equal(patch.status, 200, JSON.stringify(patch.data))
  const rows = await notificationsOf('AGENT_A')
  const assigned = rows.find((row) => row.type === 'LEAD_ASSIGNED')
  assert.ok(assigned, 'expected LEAD_ASSIGNED notification')
  assert.equal(assigned.entityType, 'Lead')
  assert.equal(assigned.category, 'LEAD')
  assert.equal(assigned.targetUrl, '/leads')
})

test('Package 33: scheduler sends an upcoming appointment alert with an allowlisted deep link', async () => {
  const result = await runReminders(new Date(), { organizationIds: [state.orgIds[0]] })
  assert.ok(result.appointmentUpcomingReminders >= 1)
  assert.ok(result.paymentReminders >= 1)
  const rows = await notificationsOf('AGENT_A')
  const upcoming = rows.find((row) => row.type === 'APPOINTMENT_UPCOMING_24H')
  assert.ok(upcoming, 'expected APPOINTMENT_UPCOMING_24H notification')
  assert.equal(upcoming.entityId, state.appointmentId)
  assert.equal(upcoming.targetUrl, `/appointments/${state.appointmentId}`)
  assert.equal(resolveNotificationTarget({ actionUrl: 'https://evil.example/x', entityType: 'Appointment', entityId: state.appointmentId }), '/appointments')

  const overdue = rows.find((row) => row.type === 'PAYMENT_OVERDUE_REMINDER')
  assert.ok(overdue, 'expected PAYMENT_OVERDUE_REMINDER notification')
  assert.equal(overdue.metadata.installmentAlert, true)
  assert.equal(overdue.targetUrl, `/deals/${state.dealId}`)
})

test('Package 33: deal stage changes notify participants and preserve the transition metadata', async () => {
  const patch = await api('PATCH', `/api/deals/${state.dealId}`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'ACTIVE' }
  })
  assert.equal(patch.status, 200, JSON.stringify(patch.data))
  const rows = await notificationsOf('AGENT_A')
  const stage = rows.find((row) => row.type === 'DEAL_STATUS_CHANGED')
  assert.ok(stage, 'expected DEAL_STATUS_CHANGED notification')
  assert.equal(stage.metadata.beforeStatus, 'DRAFT')
  assert.equal(stage.metadata.afterStatus, 'ACTIVE')
  assert.equal(stage.targetUrl, `/deals/${state.dealId}`)
})

test('Package 33: POST read-all is tenant and user scoped, and the UI exposes the bell and Arabic RTL panel', async () => {
  await prisma.notification.createMany({
    data: [
      { userId: state.userIds[1], organizationId: state.orgIds[0], type: 'SYSTEM_TEST', title: 'A', message: 'A' },
      { userId: state.userIds[2], organizationId: state.orgIds[1], type: 'SYSTEM_TEST', title: 'B', message: 'B' }
    ]
  })
  const before = await api('GET', '/api/notifications/unread-count', { token: state.tokens.ADMIN_B })
  assert.ok(before.data.data.count >= 1)
  const marked = await api('POST', '/api/notifications/read-all', { token: state.tokens.ADMIN_A })
  assert.equal(marked.status, 200)
  assert.ok(marked.data.data.updated >= 1)
  const afterA = await api('GET', '/api/notifications/unread-count', { token: state.tokens.ADMIN_A })
  const afterB = await api('GET', '/api/notifications/unread-count', { token: state.tokens.ADMIN_B })
  assert.equal(afterA.data.data.count, 0)
  assert.equal(afterB.data.data.count, before.data.data.count)

  const layout = read('frontend/src/components/Layout.vue')
  assert.match(layout, /notification-panel/)
  assert.match(layout, /:dir="store\.direction"/)
  assert.match(layout, /unreadNotificationCount/)
  const backendTargets = read('backend/utils/notificationTargets.ts')
  assert.match(backendTargets, /Package 33: appointment reminders deep-link/)
})

test('Package 33: the API no longer offers an unscoped global notification feed', async () => {
  const response = await api('GET', '/api/notifications', { token: state.tokens.ADMIN_A })
  assert.equal(response.status, 200)
  const users = new Set(response.data.data.map((row) => row.userId))
  assert.deepEqual([...users], [state.userIds[0]])
  assert.equal(typeof response.data.unreadCount, 'number')
  assert.equal(response.data.data.every((row) => row.organizationId === state.orgIds[0]), true)
})
