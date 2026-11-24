const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const bcrypt = require('bcrypt')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.NODE_ENV = 'test'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')
const { computeLeadPriority, priorityTierForScore } = require('../dist-backend/utils/leadPriority.js')

const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG15-${runId}`
const state = {
  orgAId: null,
  orgBId: null,
  userIds: [],
  propertyId: null,
  highLeadId: null,
  lowLeadId: null,
  expectedHigh: null
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

async function createFixtureOrg(suffix, key) {
  const organization = await prisma.organization.create({
    data: {
      name: `${tag} ${suffix}`,
      slug: `${tag.toLowerCase()}-${suffix.toLowerCase()}`,
      currency: 'USD',
      baseCurrency: 'USD'
    },
    select: { id: true }
  })
  const password = `Package15!${crypto.randomBytes(10).toString('base64url')}`
  const user = await prisma.user.create({
    data: {
      email: `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`,
      password: await bcrypt.hash(password, 10),
      role: 'ADMIN',
      organizationId: organization.id,
      firstName: 'Package 15',
      isActive: true
    },
    select: { id: true, email: true }
  })
  state.userIds.push(user.id)
  const login = await api('POST', '/api/auth/login', {
    body: { email: user.email, password }
  })
  assert.equal(login.status, 200, `login should succeed for ${key}`)
  return { organizationId: organization.id, token: login.data.data.token }
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const orgA = await createFixtureOrg('a', 'admin-a')
  state.orgAId = orgA.organizationId
  state.tokenA = orgA.token
  const orgB = await createFixtureOrg('b', 'admin-b')
  state.orgBId = orgB.organizationId
  state.tokenB = orgB.token

  const property = await prisma.property.create({
    data: {
      referenceNumber: `${tag}-PROPERTY`,
      title: 'Priority test property',
      type: 'APARTMENT',
      organizationId: state.orgAId
    },
    select: { id: true }
  })
  state.propertyId = property.id
})

test.after(async () => {
  try {
    const organizationIds = [state.orgAId, state.orgBId].filter(Boolean)
    if (organizationIds.length) {
      await prisma.$transaction(async (tx) => {
        const leads = await tx.lead.findMany({
          where: { OR: [{ propertyId: state.propertyId }, { property: { organizationId: { in: organizationIds } } }] },
          select: { id: true }
        })
        const leadIds = leads.map((lead) => lead.id)
        if (leadIds.length) await tx.leadNote.deleteMany({ where: { leadId: { in: leadIds } } })
        await tx.notification.deleteMany({ where: { organizationId: { in: organizationIds } } })
        await tx.auditLog.deleteMany({ where: { userId: { in: state.userIds } } })
        await tx.lead.deleteMany({ where: { id: { in: leadIds } } })
        await tx.property.deleteMany({ where: { organizationId: { in: organizationIds } } })
        await tx.user.deleteMany({ where: { organizationId: { in: organizationIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: organizationIds } } })
        await tx.organization.deleteMany({ where: { id: { in: organizationIds } } })
      })
    }
  } finally {
    await shutdown()
  }
})

test('priority scoring is deterministic, bounded and tiered', () => {
  const base = { createdAt: new Date('2026-11-24T12:00:00.000Z') }
  const hot = computeLeadPriority({
    ...base,
    source: 'Referral',
    status: 'NEW',
    budgetMax: '900000',
    email: 'hot@example.invalid',
    phone: '+10000000000',
    propertyId: 'property-1',
    nextFollowUpAt: new Date('2026-11-25T12:00:00.000Z')
  }, new Date('2026-11-24T12:00:00.000Z'))
  assert.equal(hot.priorityScore, 87)
  assert.equal(hot.priorityTier, 'URGENT')

  const cold = computeLeadPriority({
    ...base,
    status: 'LOST',
    createdAt: new Date('2026-09-01T12:00:00.000Z')
  }, new Date('2026-11-24T12:00:00.000Z'))
  assert.equal(cold.priorityTier, 'LOW')
  assert.ok(cold.priorityScore < 25)

  assert.equal(priorityTierForScore(74), 'HIGH')
  assert.equal(priorityTierForScore(75), 'URGENT')
  assert.equal(priorityTierForScore(-5), 'LOW')
  assert.equal(computeLeadPriority({}, new Date()).priorityScore >= 0, true)
})

test('lead create, patch and manual recompute persist source/budget priority', async () => {
  const highPayload = {
    firstName: 'High',
    lastName: 'Priority',
    email: 'high@example.invalid',
    phone: '+15550000001',
    status: 'NEW',
    source: 'Referral',
    budgetMax: 900000,
    propertyId: state.propertyId,
    nextFollowUpAt: new Date(Date.now() + 86_400_000).toISOString()
  }
  state.expectedHigh = computeLeadPriority({ ...highPayload, createdAt: new Date() })
  const high = await api('POST', '/api/leads', { token: state.tokenA, body: highPayload })
  assert.equal(high.status, 201, JSON.stringify(high.data))
  assert.equal(high.data.data.priorityScore, state.expectedHigh.priorityScore)
  assert.equal(high.data.data.priorityTier, state.expectedHigh.priorityTier)
  state.highLeadId = high.data.data.id

  const low = await api('POST', '/api/leads', {
    token: state.tokenA,
    body: { firstName: 'Low', lastName: 'Priority', status: 'LOST' }
  })
  assert.equal(low.status, 201, JSON.stringify(low.data))
  assert.equal(low.data.data.priorityTier, 'LOW')
  state.lowLeadId = low.data.data.id
  assert.ok(high.data.data.priorityScore > low.data.data.priorityScore)

  await prisma.lead.update({
    where: { id: state.highLeadId },
    data: { priorityScore: 0, priorityTier: 'LOW' }
  })
  const recomputed = await api('POST', `/api/leads/${state.highLeadId}/recompute-priority`, {
    token: state.tokenA,
    body: {}
  })
  assert.equal(recomputed.status, 200)
  assert.equal(recomputed.data.data.priorityScore, state.expectedHigh.priorityScore)
  assert.equal(recomputed.data.data.priorityTier, state.expectedHigh.priorityTier)

  const patched = await api('PATCH', `/api/leads/${state.lowLeadId}`, {
    token: state.tokenA,
    body: { source: 'Referral', budgetMax: 900000, status: 'NEW' }
  })
  assert.equal(patched.status, 200, JSON.stringify(patched.data))
  assert.ok(patched.data.data.priorityScore > 25)
  assert.notEqual(patched.data.data.priorityTier, 'LOW')
})

test('lead list supports source, budget, priority filters and priority sorting', async () => {
  const source = await api('GET', '/api/leads?source=Referral', { token: state.tokenA })
  assert.equal(source.status, 200)
  assert.equal(source.data.data.some((lead) => lead.id === state.highLeadId), true)
  assert.equal(source.data.data.every((lead) => String(lead.source).toLowerCase() === 'referral'), true)

  const budget = await api('GET', '/api/leads?budgetMin=500000', { token: state.tokenA })
  assert.equal(budget.status, 200)
  assert.equal(budget.data.data.some((lead) => lead.id === state.highLeadId), true)

  const priority = await api('GET', `/api/leads?priority=${state.expectedHigh.priorityTier}`, { token: state.tokenA })
  assert.equal(priority.status, 200)
  assert.equal(priority.data.data.some((lead) => lead.id === state.highLeadId), true)

  const sorted = await api('GET', '/api/leads?sort=priority_desc', { token: state.tokenA })
  assert.equal(sorted.status, 200)
  const scores = sorted.data.data.map((lead) => lead.priorityScore)
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a))

  const crossTenant = await api('GET', `/api/leads/${state.highLeadId}`, { token: state.tokenB })
  assert.equal(crossTenant.status, 404)
})
