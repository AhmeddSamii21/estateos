const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const bcrypt = require('bcrypt')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.NODE_ENV = 'test'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')
const {
  buildPaymentAgingSummary,
  paymentAgingBucket,
  PAYMENT_AGING_BUCKETS
} = require('../dist-backend/utils/paymentAging.js')

const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG17-${runId}`
const DAY = 86_400_000
const state = {
  orgAId: null,
  orgBId: null,
  propertyId: null,
  dealId: null,
  users: {},
  passwords: {},
  tokens: {},
  paymentIds: {},
  references: {}
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
  const password = `Package17!${crypto.randomBytes(10).toString('base64url')}`
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
  state.passwords[key] = password
  const login = await api('POST', '/api/auth/login', {
    body: { email: user.email, password }
  })
  assert.equal(login.status, 200, `${key} login should succeed`)
  state.tokens[key] = login.data.data.token
}

function dateOffset(days) {
  return new Date(Date.now() + days * DAY).toISOString()
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  state.orgAId = await createOrg('a')
  state.orgBId = await createOrg('b')
  await createUser('ADMIN_A', state.orgAId, 'ADMIN')
  await createUser('ADMIN_B', state.orgBId, 'ADMIN')
  const property = await prisma.property.create({
    data: {
      referenceNumber: `${tag}-PROPERTY`,
      title: 'Aging property',
      type: 'APARTMENT',
      organizationId: state.orgAId
    },
    select: { id: true }
  })
  state.propertyId = property.id
  const deal = await api('POST', '/api/deals', {
    token: state.tokens.ADMIN_A,
    body: {
      propertyId: state.propertyId,
      type: 'SALE',
      amount: 500000,
      currency: 'USD',
      status: 'ACTIVE',
      referenceNumber: `${tag}-DEAL`
    }
  })
  assert.equal(deal.status, 201, JSON.stringify(deal.data))
  state.dealId = deal.data.data.id
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
        await tx.payment.deleteMany({ where: { deal: { organizationId: { in: orgIds } } } })
        await tx.dealClosingChecklist.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.deal.deleteMany({ where: { organizationId: { in: orgIds } } })
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

test('aging helpers expose the five required buckets and inclusive boundaries', () => {
  assert.deepEqual(PAYMENT_AGING_BUCKETS, ['CURRENT', '1_30_DAYS', '31_60_DAYS', '60_PLUS_DAYS', 'PAID'])
  const now = new Date('2026-11-24T12:00:00.000Z')
  const base = { amount: '100.00', status: 'PENDING', createdAt: now }
  assert.equal(paymentAgingBucket({ ...base, dueAt: new Date('2026-11-25T12:00:00.000Z') }, now).bucket, 'CURRENT')
  assert.equal(paymentAgingBucket({ ...base, dueAt: new Date('2026-11-24T11:00:00.000Z') }, now).bucket, '1_30_DAYS')
  assert.equal(paymentAgingBucket({ ...base, dueAt: new Date('2026-10-24T12:00:00.000Z') }, now).bucket, '31_60_DAYS')
  assert.equal(paymentAgingBucket({ ...base, dueAt: new Date('2026-09-24T12:00:00.000Z') }, now).bucket, '60_PLUS_DAYS')
  assert.equal(paymentAgingBucket({ ...base, dueAt: null, status: 'COMPLETED' }, now).bucket, 'PAID')

  const summary = buildPaymentAgingSummary([
    { ...base, dueAt: new Date('2026-11-25T12:00:00.000Z') },
    { ...base, dueAt: new Date('2026-10-25T12:00:00.000Z'), status: 'COMPLETED' }
  ], now)
  assert.equal(summary.CURRENT.count, 1)
  assert.equal(summary.PAID.count, 1)
  assert.equal(summary['31_60_DAYS'].count, 0)
})

test('recorded payments are assigned an aging bucket and support list filtering', async () => {
  const cases = [
    ['current', 10, 'PENDING', 'CURRENT'],
    ['recent', -10, 'PENDING', '1_30_DAYS'],
    ['middle', -45, 'PENDING', '31_60_DAYS'],
    ['old', -100, 'PENDING', '60_PLUS_DAYS'],
    ['settled', -5, 'COMPLETED', 'PAID']
  ]
  for (const [key, days, status, expected] of cases) {
    const reference = `${tag}-${key.toUpperCase()}`
    state.references[key] = reference
    const response = await api('POST', '/api/finance/payments', {
      token: state.tokens.ADMIN_A,
      body: {
        dealId: state.dealId,
        amount: 1000 + cases.findIndex((item) => item[0] === key),
        currency: 'USD',
        status,
        reference,
        dueAt: dateOffset(days)
      }
    })
    assert.equal(response.status, 201, JSON.stringify(response.data))
    assert.equal(response.data.data.aging.bucket, expected)
    state.paymentIds[key] = response.data.data.id
  }

  for (const [key, , , expected] of cases) {
    const filtered = await api('GET', `/api/finance/payments?aging=${expected}`, { token: state.tokens.ADMIN_A })
    assert.equal(filtered.status, 200, JSON.stringify(filtered.data))
    assert.equal(filtered.data.data.some((payment) => payment.id === state.paymentIds[key]), true)
    assert.equal(filtered.data.data.every((payment) => payment.aging.bucket === expected), true)
    assert.equal(filtered.data.agingSummary[expected].count >= 1, true)
  }
})

test('deal summary, organization aging endpoint and reports expose aging summaries', async () => {
  const summary = await api('GET', `/api/finance/payments/summary?dealId=${state.dealId}`, { token: state.tokens.ADMIN_A })
  assert.equal(summary.status, 200, JSON.stringify(summary.data))
  assert.deepEqual(Object.keys(summary.data.data.aging).sort(), [...PAYMENT_AGING_BUCKETS].sort())
  assert.equal(summary.data.data.aging.CURRENT.count, 1)
  assert.equal(summary.data.data.aging['1_30_DAYS'].count, 1)
  assert.equal(summary.data.data.aging['31_60_DAYS'].count, 1)
  assert.equal(summary.data.data.aging['60_PLUS_DAYS'].count, 1)
  assert.equal(summary.data.data.aging.PAID.count, 1)

  const orgAging = await api('GET', '/api/finance/payments/aging', { token: state.tokens.ADMIN_A })
  assert.equal(orgAging.status, 200)
  assert.equal(orgAging.data.data.total, 5)
  assert.equal(orgAging.data.data.summary['60_PLUS_DAYS'].count, 1)

  const orgBAging = await api('GET', '/api/finance/payments/aging', { token: state.tokens.ADMIN_B })
  assert.equal(orgBAging.status, 200)
  assert.equal(orgBAging.data.data.total, 0)

  const report = await api('GET', '/api/reports/summary', { token: state.tokens.ADMIN_A })
  assert.equal(report.status, 200, JSON.stringify(report.data))
  assert.ok(report.data.data.finance.paymentAging)
  assert.equal(report.data.data.finance.paymentAging.PAID.count, 1)

  const financial = await api('GET', '/api/reports/financial', { token: state.tokens.ADMIN_A })
  assert.equal(financial.status, 200)
  assert.equal(financial.data.data.paymentAging['1_30_DAYS'].count, 1)
})

test('updating status or due date recomputes the aging bucket', async () => {
  const patched = await api('PATCH', `/api/finance/payments/${state.paymentIds.old}`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'COMPLETED' }
  })
  assert.equal(patched.status, 200, JSON.stringify(patched.data))
  assert.equal(patched.data.data.aging.bucket, 'PAID')

  const moved = await api('PATCH', `/api/finance/payments/${state.paymentIds.recent}`, {
    token: state.tokens.ADMIN_A,
    body: { dueAt: dateOffset(5) }
  })
  assert.equal(moved.status, 200, JSON.stringify(moved.data))
  assert.equal(moved.data.data.aging.bucket, 'CURRENT')

  const invalid = await api('GET', '/api/finance/payments?aging=NOT_A_BUCKET', { token: state.tokens.ADMIN_A })
  assert.equal(invalid.status, 400)
})
