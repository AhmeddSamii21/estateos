const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const bcrypt = require('bcrypt')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.NODE_ENV = 'test'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')
const { createNotifications } = require('../dist-backend/services/notifications.js')
const {
  DEAL_TRANSITIONS,
  assertDealTransition,
  assertInitialDealStatus
} = require('../dist-backend/utils/dealStatus.js')

const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `DEALFLOW-${runId}`

const state = {
  orgAId: null,
  orgBId: null,
  users: {},
  passwords: {},
  tokens: {},
  propertyAId: null,
  propertyBId: null
}

let baseUrl
let server

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

async function createOrganization(suffix) {
  const organization = await prisma.organization.create({
    data: {
      name: `${tag} ${suffix}`,
      slug: `${tag.toLowerCase()}-${suffix.toLowerCase()}`,
      currency: 'USD',
      baseCurrency: 'USD'
    },
    select: { id: true }
  })
  return organization.id
}

async function createUser(key, organizationId, role) {
  const password = `DealFlow1!${crypto.randomBytes(12).toString('base64url')}`
  const user = await prisma.user.create({
    data: {
      email: `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`,
      password: await bcrypt.hash(password, 10),
      role,
      organizationId,
      firstName: `Deal ${key}`,
      isActive: true
    },
    select: { id: true, email: true, role: true, organizationId: true }
  })
  state.users[key] = user
  state.passwords[key] = password
  return user
}

async function login(key) {
  const response = await api('POST', '/api/auth/login', {
    body: { email: state.users[key].email, password: state.passwords[key] }
  })
  assert.equal(response.status, 200, `${key} login should succeed`)
  state.tokens[key] = response.data.data.token
}

async function createProperty(key, organizationId, reference) {
  const property = await prisma.property.create({
    data: {
      referenceNumber: `${tag}-${reference}`,
      title: `${key} property`,
      type: 'APARTMENT',
      organizationId
    },
    select: { id: true }
  })
  state[`${key}Id`] = property.id
  return property.id
}

function dealPayload(overrides = {}) {
  return {
    propertyId: state.propertyAId,
    type: 'SALE',
    amount: 100000,
    currency: 'USD',
    referenceNumber: `${tag}-${crypto.randomBytes(6).toString('hex')}`,
    ...overrides
  }
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  state.orgAId = await createOrganization('org-a')
  state.orgBId = await createOrganization('org-b')
  await createUser('ADMIN_A', state.orgAId, 'ADMIN')
  await createUser('AGENT_A', state.orgAId, 'AGENT')
  await createUser('ADMIN_B', state.orgBId, 'ADMIN')
  for (const key of Object.keys(state.users)) await login(key)
  await createProperty('propertyA', state.orgAId, 'property-a')
  await createProperty('propertyB', state.orgBId, 'property-b')
})

test.after(async () => {
  try {
    const orgIds = [state.orgAId, state.orgBId].filter(Boolean)
    if (orgIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { organizationId: { in: orgIds } },
        select: { id: true }
      })
      const userIds = users.map((user) => user.id)
      await prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({
          where: {
            OR: [{ userId: { in: userIds } }, { organizationId: { in: orgIds } }]
          }
        })
        await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })
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

test('deal transition rules are forward-only and terminal stages are closed', () => {
  assert.deepEqual(DEAL_TRANSITIONS.DRAFT, ['PENDING', 'ACTIVE', 'CANCELLED'])
  assert.doesNotThrow(() => assertInitialDealStatus('DRAFT'))
  assert.doesNotThrow(() => assertInitialDealStatus('PENDING'))
  assert.throws(() => assertInitialDealStatus('COMPLETED'), /cannot be created/i)
  assert.throws(() => assertInitialDealStatus('CANCELLED'), /cannot be created/i)

  assert.doesNotThrow(() => assertDealTransition('DRAFT', 'PENDING'))
  assert.doesNotThrow(() => assertDealTransition('ACTIVE', 'COMPLETED'))
  assert.doesNotThrow(() => assertDealTransition('PENDING', 'PENDING'))
  assert.throws(() => assertDealTransition('COMPLETED', 'ACTIVE'), /Invalid deal status transition/)
  assert.throws(() => assertDealTransition('CANCELLED', 'DRAFT'), /Invalid deal status transition/)
})

test('creating a deal rejects terminal statuses and accepts open stages', async () => {
  const rejected = await api('POST', '/api/deals', {
    token: state.tokens.AGENT_A,
    body: dealPayload({ status: 'COMPLETED' })
  })
  assert.equal(rejected.status, 400)
  assert.match(rejected.data.error.message, /cannot be created/i)

  const created = await api('POST', '/api/deals', {
    token: state.tokens.AGENT_A,
    body: dealPayload({ status: 'PENDING' })
  })
  assert.equal(created.status, 201)
  assert.equal(created.data.data.status, 'PENDING')
  assert.equal(created.data.data.closedAt, null)
})

test('deal updates enforce valid transitions and close dates', async () => {
  const created = await api('POST', '/api/deals', {
    token: state.tokens.AGENT_A,
    body: dealPayload()
  })
  assert.equal(created.status, 201)
  const id = created.data.data.id

  const prematureClose = await api('PATCH', `/api/deals/${id}`, {
    token: state.tokens.AGENT_A,
    body: { closedAt: new Date().toISOString() }
  })
  assert.equal(prematureClose.status, 400)
  assert.match(prematureClose.data.error.message, /closedAt/i)

  const invalid = await api('PATCH', `/api/deals/${id}`, {
    token: state.tokens.AGENT_A,
    body: { status: 'COMPLETED' }
  })
  assert.equal(invalid.status, 400)
  assert.match(invalid.data.error.message, /Invalid deal status transition/)

  // Package 16 guardrail: completing a deal requires the closing checklist.
  for (const itemKey of ['PAYMENT_SETTLED', 'DOCUMENTS_COMPLETE', 'CONTRACT_SIGNED', 'HANDOVER_CONFIRMED']) {
    const checklist = await api('PATCH', `/api/deals/${id}/checklist/${itemKey}`, {
      token: state.tokens.AGENT_A,
      body: { completed: true }
    })
    assert.equal(checklist.status, 200, `checklist item ${itemKey} should be toggleable`)
  }

  for (const status of ['PENDING', 'ACTIVE', 'COMPLETED']) {
    const response = await api('PATCH', `/api/deals/${id}`, {
      token: state.tokens.AGENT_A,
      body: { status }
    })
    assert.equal(response.status, 200, `transition to ${status} should succeed`)
    assert.equal(response.data.data.status, status)
    if (status === 'COMPLETED') assert.ok(response.data.data.closedAt)
  }

  const reopen = await api('PATCH', `/api/deals/${id}`, {
    token: state.tokens.AGENT_A,
    body: { status: 'ACTIVE' }
  })
  assert.equal(reopen.status, 400)
})

test('stage changes notify managers once per transition and record activity', async () => {
  const created = await api('POST', '/api/deals', {
    token: state.tokens.AGENT_A,
    body: dealPayload()
  })
  assert.equal(created.status, 201)
  const id = created.data.data.id

  const first = await api('PATCH', `/api/deals/${id}`, {
    token: state.tokens.AGENT_A,
    body: { status: 'PENDING' }
  })
  assert.equal(first.status, 200)

  const stageNotifications = () => prisma.notification.count({
    where: {
      entityType: 'Deal',
      entityId: id,
      type: 'DEAL_STATUS_CHANGED'
    }
  })
  assert.equal(await stageNotifications(), 1)

  // Repeating the same stage without a transition must not spam managers.
  const repeat = await api('PATCH', `/api/deals/${id}`, {
    token: state.tokens.AGENT_A,
    body: { status: 'PENDING', notes: 'Discussed with the client' }
  })
  assert.equal(repeat.status, 200)
  assert.equal(await stageNotifications(), 1)

  const second = await api('PATCH', `/api/deals/${id}`, {
    token: state.tokens.AGENT_A,
    body: { status: 'ACTIVE' }
  })
  assert.equal(second.status, 200)
  assert.equal(await stageNotifications(), 2)

  const notification = await prisma.notification.findFirst({
    where: { entityType: 'Deal', entityId: id, type: 'DEAL_STATUS_CHANGED' },
    orderBy: { createdAt: 'desc' }
  })
  assert.equal(notification.actionUrl, `/deals/${id}`)

  const audits = await prisma.auditLog.findMany({
    where: { entityType: 'Deal', entityId: id, action: 'DEAL_STATUS_CHANGED' },
    orderBy: { createdAt: 'asc' }
  })
  assert.deepEqual(audits.map((row) => JSON.parse(row.details || '{}').after), ['PENDING', 'ACTIVE'])

  const detail = await api('GET', `/api/deals/${id}`, { token: state.tokens.AGENT_A })
  assert.equal(detail.status, 200)
  // The timeline also contains creation and ordinary update entries; verify the
  // status-change subset matches the dedicated audit rows.
  const statusEntries = detail.data.data.auditTrail.filter((entry) => entry.action === 'DEAL_STATUS_CHANGED')
  assert.equal(statusEntries.length, audits.length)
  assert.deepEqual(
    statusEntries.map((entry) => entry.changes.find((change) => change.field === 'value')?.after).reverse(),
    ['PENDING', 'ACTIVE']
  )
})

test('notifications deduplicate identical events across requests', async () => {
  const input = {
    userId: state.users.AGENT_A.id,
    organizationId: state.orgAId,
    type: 'DEAL_DEDUPE_TEST',
    title: 'Deal dedupe test',
    message: `${tag} stage retry`,
    entityType: 'Deal',
    entityId: 'dedupe-test',
    actionUrl: '/deals/dedupe-test',
    metadata: { transition: 'DRAFT->PENDING' }
  }

  assert.equal(await createNotifications(prisma, [input]), 1)
  assert.equal(await createNotifications(prisma, [input]), 0)
  assert.equal(await createNotifications(prisma, [{ ...input, metadata: { transition: 'PENDING->ACTIVE' } }]), 1)

  const rows = await prisma.notification.findMany({
    where: { type: 'DEAL_DEDUPE_TEST', userId: input.userId },
    select: { metadata: true }
  })
  assert.equal(rows.length, 2)
  assert.deepEqual(
    rows.map((row) => row.metadata?.transition).sort(),
    ['DRAFT->PENDING', 'PENDING->ACTIVE']
  )
})

test('deal detail audit rows are strictly scoped to the current organization', async () => {
  const own = await api('POST', '/api/deals', {
    token: state.tokens.AGENT_A,
    body: dealPayload()
  })
  assert.equal(own.status, 201)
  const ownId = own.data.data.id

  const foreign = await api('POST', '/api/deals', {
    token: state.tokens.ADMIN_B,
    body: dealPayload({
      propertyId: state.propertyBId,
      referenceNumber: `${tag}-foreign-deal`
    })
  })
  assert.equal(foreign.status, 201)
  const foreignId = foreign.data.data.id

  // Audit row for the local deal written by a foreign-org actor.
  await prisma.auditLog.create({
    data: {
      userId: state.users.ADMIN_B.id,
      action: 'DEAL_UPDATED',
      entityType: 'Deal',
      entityId: ownId,
      details: JSON.stringify({ leaked: true })
    }
  })
  // Audit row for a foreign deal written by a local actor.
  await prisma.auditLog.create({
    data: {
      userId: state.users.AGENT_A.id,
      action: 'DEAL_UPDATED',
      entityType: 'Deal',
      entityId: foreignId,
      details: JSON.stringify({ leaked: true })
    }
  })
  // A legitimate local audit row must still be visible.
  await prisma.auditLog.create({
    data: {
      userId: state.users.AGENT_A.id,
      action: 'DEAL_UPDATED',
      entityType: 'Deal',
      entityId: ownId,
      details: JSON.stringify({ local: true })
    }
  })

  const ownDetail = await api('GET', `/api/deals/${ownId}`, { token: state.tokens.AGENT_A })
  assert.equal(ownDetail.status, 200)
  const ownTrail = JSON.stringify(ownDetail.data.data.auditTrail)
  assert.match(ownTrail, /local/)
  assert.doesNotMatch(ownTrail, /leaked/)

  const foreignDetail = await api('GET', `/api/deals/${foreignId}`, { token: state.tokens.ADMIN_B })
  assert.equal(foreignDetail.status, 200)
  assert.doesNotMatch(JSON.stringify(foreignDetail.data.data.auditTrail), /leaked/)

  const crossOrgDetail = await api('GET', `/api/deals/${foreignId}`, { token: state.tokens.AGENT_A })
  assert.equal(crossOrgDetail.status, 404)
})

test('global activity feed applies the same actor and entity organization checks', async () => {
  const own = await api('POST', '/api/deals', {
    token: state.tokens.AGENT_A,
    body: dealPayload({ referenceNumber: `${tag}-global-own` })
  })
  assert.equal(own.status, 201)
  const foreign = await api('POST', '/api/deals', {
    token: state.tokens.ADMIN_B,
    body: dealPayload({
      propertyId: state.propertyBId,
      referenceNumber: `${tag}-global-foreign`
    })
  })
  assert.equal(foreign.status, 201)

  await prisma.auditLog.createMany({
    data: [
      {
        userId: state.users.ADMIN_B.id,
        action: 'GLOBAL_SCOPE_TEST',
        entityType: 'Deal',
        entityId: own.data.data.id,
        details: JSON.stringify({ marker: 'leaked-by-foreign-actor' })
      },
      {
        userId: state.users.AGENT_A.id,
        action: 'GLOBAL_SCOPE_TEST',
        entityType: 'Deal',
        entityId: foreign.data.data.id,
        details: JSON.stringify({ marker: 'leaked-by-foreign-entity' })
      },
      {
        userId: state.users.AGENT_A.id,
        action: 'GLOBAL_SCOPE_TEST',
        entityType: 'Deal',
        entityId: own.data.data.id,
        details: JSON.stringify({ marker: 'local-visible' })
      }
    ]
  })

  const feed = await api('GET', '/api/activity?entityType=Deal&action=GLOBAL_SCOPE_TEST&limit=100', {
    token: state.tokens.AGENT_A
  })
  assert.equal(feed.status, 200)
  assert.equal(feed.data.data.length, 1)
  assert.equal(feed.data.data[0].metadata.marker, 'local-visible')
})
