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
const tag = `PKG20-${runId}`
const state = {
  orgAId: null,
  orgBId: null,
  users: {},
  tokens: {},
  propertyAIds: [],
  propertyBId: null
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

async function raw(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  return { status: response.status, headers: response.headers, text: await response.text() }
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
  const password = `Package20!${crypto.randomBytes(10).toString('base64url')}`
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

async function createProperty(organizationId, title, assignedAgentId = null) {
  const property = await prisma.property.create({
    data: {
      referenceNumber: `${tag}-${crypto.randomBytes(5).toString('hex')}`,
      title,
      type: 'APARTMENT',
      organizationId,
      assignedAgentId
    },
    select: { id: true }
  })
  return property.id
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

  state.propertyAIds.push(await createProperty(state.orgAId, `${tag} audit one`, state.users.AGENT_A.id))
  state.propertyAIds.push(await createProperty(state.orgAId, `${tag} audit two`, state.users.AGENT_A.id))
  state.propertyBId = await createProperty(state.orgBId, `${tag} other tenant secret`)

  for (const [index, propertyId] of state.propertyAIds.entries()) {
    const response = await api('PATCH', `/api/properties/${propertyId}`, {
      token: state.tokens.ADMIN_A,
      body: { title: `${tag} audit ${index === 0 ? 'one' : 'two'} updated` }
    })
    assert.equal(response.status, 200, JSON.stringify(response.data))
  }
  const other = await api('PATCH', `/api/properties/${state.propertyBId}`, {
    token: state.tokens.ADMIN_B,
    body: { title: `${tag} other tenant updated` }
  })
  assert.equal(other.status, 200, JSON.stringify(other.data))
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

test('role permission matrix is available to management only', async () => {
  const response = await api('GET', '/api/settings/permissions', { token: state.tokens.ADMIN_A })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.deepEqual(response.data.data.roles, ['ADMIN', 'MANAGER', 'AGENT', 'ACCOUNTANT'])
  assert.ok(response.data.data.permissions.includes('audit.export'))
  assert.equal(response.data.data.matrix.ADMIN['audit.export'], true)
  assert.equal(response.data.data.matrix.MANAGER['snapshots.export'], false)
  assert.equal(response.data.data.matrix.AGENT['finance.manage'], false)
  assert.equal(response.data.data.matrix.ACCOUNTANT['reports.view'], true)

  const denied = await api('GET', '/api/settings/permissions', { token: state.tokens.AGENT_A })
  assert.equal(denied.status, 403)
})

test('audit explorer filters, paginates and isolates tenants', async () => {
  const first = await api('GET', '/api/activity?entityType=Property&action=PROPERTY_UPDATED&limit=1', {
    token: state.tokens.ADMIN_A
  })
  assert.equal(first.status, 200, JSON.stringify(first.data))
  assert.equal(first.data.data.length, 1)
  assert.ok(first.data.nextCursor)
  assert.equal(first.data.pagination.hasMore, true)
  assert.equal(first.data.pagination.limit, 1)
  assert.equal(first.data.data[0].actor.id, state.users.ADMIN_A.id)

  const second = await api('GET', `/api/activity?entityType=Property&action=PROPERTY_UPDATED&limit=1&cursor=${encodeURIComponent(first.data.nextCursor)}`, {
    token: state.tokens.ADMIN_A
  })
  assert.equal(second.status, 200, JSON.stringify(second.data))
  assert.equal(second.data.data.length, 1)
  assert.notEqual(second.data.data[0].id, first.data.data[0].id)

  const all = await api('GET', '/api/activity?entityType=Property&action=PROPERTY_UPDATED&limit=25', {
    token: state.tokens.ADMIN_A
  })
  assert.equal(all.status, 200)
  assert.equal(all.data.data.length, 2)
  assert.deepEqual(
    all.data.data.map((entry) => entry.entityId).sort(),
    [...state.propertyAIds].sort()
  )

  const otherTenant = await api('GET', '/api/activity?entityType=Property&limit=25', { token: state.tokens.ADMIN_B })
  assert.equal(otherTenant.status, 200)
  assert.deepEqual(otherTenant.data.data.map((entry) => entry.entityId), [state.propertyBId])
})

test('actor, date and validation filters are enforced', async () => {
  const byActor = await api('GET', `/api/activity?entityType=Property&action=PROPERTY_UPDATED&actor=${encodeURIComponent(state.users.ADMIN_A.email)}`, {
    token: state.tokens.ADMIN_A
  })
  assert.equal(byActor.status, 200, JSON.stringify(byActor.data))
  assert.equal(byActor.data.data.length, 2)
  assert.ok(byActor.data.data.every((entry) => entry.actor.email === state.users.ADMIN_A.email))

  const unknown = await api('GET', '/api/activity?entityType=Property&actor=does-not-exist', { token: state.tokens.ADMIN_A })
  assert.equal(unknown.status, 200)
  assert.equal(unknown.data.data.length, 0)

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const future = await api('GET', `/api/activity?entityType=Property&from=${tomorrow}`, { token: state.tokens.ADMIN_A })
  assert.equal(future.status, 200)
  assert.equal(future.data.data.length, 0)

  const invalid = await api('GET', '/api/activity?from=2026-12-31&to=2026-01-01', { token: state.tokens.ADMIN_A })
  assert.equal(invalid.status, 400)
  const invalidAction = await api('GET', '/api/activity?action=DROP%20TABLE', { token: state.tokens.ADMIN_A })
  assert.equal(invalidAction.status, 400)

  const agentFinance = await api('GET', '/api/activity?entityType=Payment', { token: state.tokens.AGENT_A })
  assert.equal(agentFinance.status, 403)
})

test('CSV export uses the same filters and never leaks another tenant', async () => {
  const exported = await raw('/api/activity/export?entityType=Property&action=PROPERTY_UPDATED', state.tokens.ADMIN_A)
  assert.equal(exported.status, 200)
  assert.match(exported.headers.get('content-type'), /text\/csv/)
  assert.match(exported.headers.get('content-disposition'), /attachment; filename="activity-/)
  assert.match(exported.headers.get('x-content-type-options'), /nosniff/)
  assert.match(exported.text, /timestamp,action,entityType,entityId,entity,actorId,actorEmail,actorRole,metadata/)
  assert.match(exported.text, /PROPERTY_UPDATED/)
  assert.match(exported.text, new RegExp(state.propertyAIds[0]))
  assert.equal(exported.text.includes(state.propertyBId), false)
  assert.equal(exported.text.includes('other tenant secret'), false)

  const filtered = await raw('/api/activity/export?entityType=Property&actor=does-not-exist', state.tokens.ADMIN_A)
  assert.equal(filtered.status, 200)
  assert.equal(filtered.text.trim().split(/\r?\n/).length, 1)

  const forbidden = await raw('/api/activity/export?entityType=Payment', state.tokens.AGENT_A)
  assert.equal(forbidden.status, 403)
})
