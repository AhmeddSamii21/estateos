const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const bcrypt = require('bcrypt')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.NODE_ENV = 'test'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG16-${runId}`
const state = {
  orgAId: null,
  orgBId: null,
  propertyId: null,
  users: {},
  passwords: {},
  tokens: {},
  dealIds: []
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
  const password = `Package16!${crypto.randomBytes(10).toString('base64url')}`
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

function dealPayload(overrides = {}) {
  return {
    propertyId: state.propertyId,
    type: 'SALE',
    amount: 250000,
    currency: 'USD',
    status: 'ACTIVE',
    referenceNumber: `${tag}-${crypto.randomBytes(6).toString('hex')}`,
    ...overrides
  }
}

async function createDeal(token, overrides = {}) {
  const created = await api('POST', '/api/deals', { token, body: dealPayload(overrides) })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  state.dealIds.push(created.data.data.id)
  return created.data.data
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
      title: 'Checklist property',
      type: 'APARTMENT',
      organizationId: state.orgAId
    },
    select: { id: true }
  })
  state.propertyId = property.id
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

test('new deals get a standard four-item closing checklist', async () => {
  const deal = await createDeal(state.tokens.ADMIN_A, { userId: state.users.AGENT_A.id })
  state.primaryDealId = deal.id
  const response = await api('GET', `/api/deals/${deal.id}/checklist`, { token: state.tokens.ADMIN_A })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.equal(response.data.data.total, 4)
  assert.equal(response.data.data.completed, 0)
  assert.equal(response.data.data.isComplete, false)
  assert.deepEqual(
    response.data.data.items.map((item) => item.itemKey).sort(),
    ['CONTRACT_SIGNED', 'DOCUMENTS_COMPLETE', 'HANDOVER_CONFIRMED', 'PAYMENT_SETTLED']
  )
})

test('checklist toggles persist and write an audit entry', async () => {
  const response = await api('PATCH', `/api/deals/${state.primaryDealId}/checklist/PAYMENT_SETTLED`, {
    token: state.tokens.AGENT_A,
    body: { completed: true }
  })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.equal(response.data.data.progress.completed, 1)
  assert.equal(response.data.data.row.isCompleted, true)
  assert.ok(response.data.data.row.completedAt)

  const logs = await prisma.auditLog.findMany({
    where: { entityType: 'Deal', entityId: state.primaryDealId, action: 'DEAL_CHECKLIST_UPDATED' },
    select: { details: true, userId: true }
  })
  assert.equal(logs.length, 1)
  assert.equal(JSON.parse(logs[0].details).itemKey, 'PAYMENT_SETTLED')

  const invalid = await api('PATCH', `/api/deals/${state.primaryDealId}/checklist/UNKNOWN_ITEM`, {
    token: state.tokens.ADMIN_A,
    body: { completed: true }
  })
  assert.equal(invalid.status, 400)
})

test('completion is blocked until the checklist is complete and overrides require management', async () => {
  const blocked = await api('PATCH', `/api/deals/${state.primaryDealId}`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'COMPLETED' }
  })
  assert.equal(blocked.status, 400)
  assert.match(blocked.data.error.message, /checklist/i)

  const agentOverride = await api('PATCH', `/api/deals/${state.primaryDealId}`, {
    token: state.tokens.AGENT_A,
    body: { status: 'COMPLETED', checklistOverrideReason: 'Agent insists' }
  })
  assert.equal(agentOverride.status, 403)
  assert.match(agentOverride.data.error.message, /ADMIN or MANAGER/i)

  const override = await api('PATCH', `/api/deals/${state.primaryDealId}`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'COMPLETED', checklistOverrideReason: 'Signed waiver from the owner' }
  })
  assert.equal(override.status, 200, JSON.stringify(override.data))
  assert.equal(override.data.data.status, 'COMPLETED')
  assert.equal(override.data.data.checklistOverrideReason, 'Signed waiver from the owner')
  assert.ok(override.data.data.checklistOverriddenAt)

  const audit = await prisma.auditLog.findFirst({
    where: { entityType: 'Deal', entityId: state.primaryDealId, action: 'DEAL_STATUS_CHANGED' },
    orderBy: { createdAt: 'desc' },
    select: { details: true }
  })
  assert.equal(JSON.parse(audit.details).checklistOverride, 'Signed waiver from the owner')
})

test('a fully checked checklist allows completion without an override', async () => {
  const deal = await createDeal(state.tokens.AGENT_A)
  const keys = ['PAYMENT_SETTLED', 'DOCUMENTS_COMPLETE', 'CONTRACT_SIGNED', 'HANDOVER_CONFIRMED']
  for (const itemKey of keys) {
    const response = await api('PATCH', `/api/deals/${deal.id}/checklist/${itemKey}`, {
      token: state.tokens.AGENT_A,
      body: { completed: true }
    })
    assert.equal(response.status, 200, JSON.stringify(response.data))
  }
  const checklist = await api('GET', `/api/deals/${deal.id}/checklist`, { token: state.tokens.AGENT_A })
  assert.equal(checklist.data.data.isComplete, true)

  const completed = await api('PATCH', `/api/deals/${deal.id}`, {
    token: state.tokens.AGENT_A,
    body: { status: 'COMPLETED' }
  })
  assert.equal(completed.status, 200, JSON.stringify(completed.data))
  assert.equal(completed.data.data.checklistOverrideReason, null)
})

test('checklist access stays inside the deal tenant', async () => {
  const foreign = await api('GET', `/api/deals/${state.primaryDealId}/checklist`, { token: state.tokens.ADMIN_B })
  assert.equal(foreign.status, 404)
  const foreignPatch = await api('PATCH', `/api/deals/${state.primaryDealId}/checklist/CONTRACT_SIGNED`, {
    token: state.tokens.ADMIN_B,
    body: { completed: true }
  })
  assert.equal(foreignPatch.status, 404)
})
