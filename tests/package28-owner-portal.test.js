const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const bcrypt = require('bcrypt')

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'
process.env.PUBLIC_RATE_LIMIT_MAX = '1000'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG28-${runId}`
const secrets = {
  ownerNote: `OWNER-NOTE-${tag}`,
  operationalNote: `INTERNAL-NOTE-${tag}`,
  agentEmail: `agent-${tag.toLowerCase()}@example.invalid`,
  dealReference: `${tag}-DEAL-SECRET`,
  payoutReference: `${tag}-PAYOUT-SECRET`
}
const state = {
  orgAId: null,
  orgBId: null,
  users: {},
  tokens: {},
  owners: {},
  properties: {},
  dealId: null,
  payoutId: null,
  portal: {}
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
    data: {
      name: `${tag} ${suffix}`,
      slug: `${tag.toLowerCase()}-${suffix}`,
      currency: 'USD',
      baseCurrency: 'USD'
    },
    select: { id: true }
  })
  return org.id
}

async function createUser(key, organizationId, role, email = `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`) {
  const password = `Package28!${crypto.randomBytes(10).toString('base64url')}`
  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 4),
      role,
      organizationId,
      firstName: `Package ${key}`,
      isActive: true
    },
    select: { id: true, email: true }
  })
  state.users[key] = user
  const login = await api('POST', '/api/auth/login', { body: { email, password } })
  assert.equal(login.status, 200, `${key} login failed: ${JSON.stringify(login.data)}`)
  state.tokens[key] = login.data.data.token
  return user
}

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key)
      collectKeys(nested, keys)
    }
  }
  return keys
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  state.orgAId = await createOrg('a')
  state.orgBId = await createOrg('b')
  await createUser('ADMIN_A', state.orgAId, 'ADMIN')
  await createUser('ADMIN_B', state.orgBId, 'ADMIN')
  await createUser('AGENT_A', state.orgAId, 'AGENT', secrets.agentEmail)

  state.owners.a = (await prisma.owner.create({
    data: {
      organizationId: state.orgAId,
      companyName: `${tag} Owner A`,
      firstName: 'Layla',
      lastName: 'Hassan',
      email: `owner-a-${tag.toLowerCase()}@example.invalid`,
      phone: '+20 100 111 0101',
      city: 'Sheikh Zayed',
      country: 'Egypt',
      notes: `EN: internal owner note. AR: ${secrets.ownerNote}`
    },
    select: { id: true }
  })).id
  state.owners.b = (await prisma.owner.create({
    data: {
      organizationId: state.orgBId,
      companyName: `${tag} Owner B`,
      city: 'Cairo',
      country: 'Egypt'
    },
    select: { id: true }
  })).id

  state.properties.a1 = (await prisma.property.create({
    data: {
      organizationId: state.orgAId,
      ownerId: state.owners.a,
      assignedAgentId: state.users.AGENT_A.id,
      referenceNumber: `${tag}-A1`,
      title: `${tag} Apartment`,
      description: 'EN: bright apartment. AR: شقة مشرقة.',
      type: 'APARTMENT',
      status: 'AVAILABLE',
      classification: 'SALE',
      city: 'Sheikh Zayed',
      price: 1000,
      currency: 'EGP',
      publicShareToken: `${tag.toLowerCase()}shareone`,
      publicShareEnabled: true,
      operationalNotes: `EN: internal only. AR: ${secrets.operationalNote}`
    },
    select: { id: true }
  })).id
  state.properties.a2 = (await prisma.property.create({
    data: {
      organizationId: state.orgAId,
      ownerId: state.owners.a,
      referenceNumber: `${tag}-A2`,
      title: `${tag} Office`,
      type: 'COMMERCIAL',
      status: 'RENTED',
      classification: 'RENT',
      city: '6th of October',
      price: 500,
      currency: 'EGP'
    },
    select: { id: true }
  })).id
  state.properties.b = (await prisma.property.create({
    data: {
      organizationId: state.orgBId,
      ownerId: state.owners.b,
      referenceNumber: `${tag}-B1`,
      title: `${tag} Other Tenant Villa`,
      type: 'VILLA',
      city: 'Cairo',
      price: 900,
      currency: 'EGP'
    },
    select: { id: true }
  })).id

  state.dealId = (await prisma.deal.create({
    data: {
      organizationId: state.orgAId,
      propertyId: state.properties.a1,
      userId: state.users.AGENT_A.id,
      referenceNumber: secrets.dealReference,
      type: 'SALE',
      status: 'ACTIVE',
      amount: 999999
    },
    select: { id: true }
  })).id
  state.payoutId = (await prisma.ownerPayout.create({
    data: {
      organizationId: state.orgAId,
      ownerId: state.owners.a,
      amount: 888888,
      currency: 'EGP',
      reference: secrets.payoutReference
    },
    select: { id: true }
  })).id
})

test.after(async () => {
  try {
    const orgIds = [state.orgAId, state.orgBId].filter(Boolean)
    if (orgIds.length) {
      const userIds = Object.values(state.users).map((user) => user.id)
      const ownerIds = Object.values(state.owners).filter(Boolean)
      const propertyIds = Object.values(state.properties).filter(Boolean)
      await prisma.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })
        await tx.notification.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.document.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.payment.deleteMany({ where: { dealId: state.dealId ? { in: [state.dealId] } : undefined } })
        await tx.dealClosingChecklist.deleteMany({ where: { dealId: state.dealId ? { in: [state.dealId] } : undefined } })
        await tx.deal.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.propertyImage.deleteMany({ where: { propertyId: { in: propertyIds } } })
        await tx.propertyDocument.deleteMany({ where: { propertyId: { in: propertyIds } } })
        await tx.property.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.ownerPayout.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.owner.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } })
      })
    }
  } finally {
    await shutdown()
  }
})

test('generates a tenant-scoped portal link and returns only allow-listed data', async () => {
  const created = await api('POST', `/api/owners/${state.owners.a}/portal-token`, { token: state.tokens.ADMIN_A })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  assert.equal(created.data.data.enabled, true)
  assert.match(created.data.data.token, /^[A-Za-z0-9_-]{16,}$/)
  assert.match(created.data.data.url, new RegExp(`/owner-portal/${created.data.data.token}$`))
  state.portal.a = created.data.data

  const publicResponse = await api('GET', `/api/public/owner-portal/${state.portal.a.token}`)
  assert.equal(publicResponse.status, 200, JSON.stringify(publicResponse.data))
  const payload = publicResponse.data.data
  assert.equal(payload.owner.displayName, `${tag} Owner A`)
  assert.equal(payload.properties.length, 2)
  assert.deepEqual(payload.properties.map((row) => row.referenceNumber).sort(), [`${tag}-A1`, `${tag}-A2`])
  assert.equal(payload.summary.properties, 2)
  assert.equal(payload.summary.deals, 1)
  assert.equal(payload.summary.dealStatuses.ACTIVE, 1)

  const keys = collectKeys(payload)
  for (const forbidden of [
    'portalToken', 'notes', 'operationalNotes', 'assignedAgentId', 'publicShareToken',
    'payouts', 'financials', 'amount', 'ownerId', 'organizationId'
  ]) {
    assert.equal(keys.has(forbidden), false, `${forbidden} must not be exposed by the public portal`)
  }
  const serialized = JSON.stringify(payload)
  for (const secret of [
    secrets.ownerNote, secrets.operationalNote, secrets.agentEmail,
    secrets.dealReference, secrets.payoutReference, `${tag}-B1`, state.portal.a.token
  ]) {
    assert.equal(serialized.includes(secret), false, `secret must not appear in portal payload: ${secret}`)
  }
})

test('regeneration rotates the token and immediately invalidates the previous one', async () => {
  const oldToken = state.portal.a.token
  const regenerated = await api('POST', `/api/owners/${state.owners.a}/portal-token/regenerate`, { token: state.tokens.ADMIN_A })
  assert.equal(regenerated.status, 200, JSON.stringify(regenerated.data))
  assert.notEqual(regenerated.data.data.token, oldToken)
  state.portal.a = regenerated.data.data

  assert.equal((await api('GET', `/api/public/owner-portal/${oldToken}`)).status, 404)
  assert.equal((await api('GET', `/api/public/owner-portal/${regenerated.data.data.token}`)).status, 200)
})

test('owner management responses never leak the portal token', async () => {
  const token = state.portal.a.token
  const list = await api('GET', `/api/owners?search=${encodeURIComponent(tag)}`, { token: state.tokens.ADMIN_A })
  assert.equal(list.status, 200, JSON.stringify(list.data))
  const detail = await api('GET', `/api/owners/${state.owners.a}`, { token: state.tokens.ADMIN_A })
  assert.equal(detail.status, 200, JSON.stringify(detail.data))
  assert.equal(JSON.stringify(list.data).includes(token), false)
  assert.equal(JSON.stringify(detail.data).includes(token), false)
  assert.equal('portalToken' in detail.data.data, false)
  assert.equal(detail.data.data.portalEnabled, true)
})

test('management endpoints reject unauthenticated and cross-tenant callers', async () => {
  const unauthenticated = await api('POST', `/api/owners/${state.owners.a}/portal-token`)
  assert.equal(unauthenticated.status, 401)

  for (const [method, suffix] of [
    ['GET', '/portal-link'],
    ['POST', '/portal-token'],
    ['POST', '/portal-token/regenerate'],
    ['POST', '/portal-token/revoke']
  ]) {
    const response = await api(method, `/api/owners/${state.owners.a}${suffix}`, { token: state.tokens.ADMIN_B })
    assert.equal(response.status, 404, `${method} ${suffix} must be tenant-scoped`)
  }

  const bLink = await api('POST', `/api/owners/${state.owners.b}/portal-token`, { token: state.tokens.ADMIN_B })
  assert.equal(bLink.status, 201)
  const bPortal = await api('GET', `/api/public/owner-portal/${bLink.data.data.token}`)
  assert.equal(bPortal.status, 200, JSON.stringify(bPortal.data))
  assert.deepEqual(bPortal.data.data.properties.map((row) => row.referenceNumber), [`${tag}-B1`])
})

test('revoke and archive both disable access permanently until a new link is issued', async () => {
  const revoked = await api('POST', `/api/owners/${state.owners.a}/portal-token/revoke`, { token: state.tokens.ADMIN_A })
  assert.equal(revoked.status, 200, JSON.stringify(revoked.data))
  assert.equal(revoked.data.data.enabled, false)
  assert.equal(revoked.data.data.token, null)
  assert.equal(revoked.data.data.url, null)
  assert.equal((await api('GET', `/api/public/owner-portal/${state.portal.a.token}`)).status, 404)

  const reissued = await api('POST', `/api/owners/${state.owners.a}/portal-token`, { token: state.tokens.ADMIN_A })
  assert.equal(reissued.status, 201)
  assert.equal((await api('GET', `/api/public/owner-portal/${reissued.data.data.token}`)).status, 200)

  const archived = await api('DELETE', `/api/owners/${state.owners.a}`, { token: state.tokens.ADMIN_A })
  assert.equal(archived.status, 200)
  assert.equal((await api('GET', `/api/public/owner-portal/${reissued.data.data.token}`)).status, 404)
  const link = await api('GET', `/api/owners/${state.owners.a}/portal-link`, { token: state.tokens.ADMIN_A })
  assert.equal(link.status, 200)
  assert.equal(link.data.data.enabled, false)
})

test('invalid tokens are rejected and the frontend route/view are wired', async () => {
  assert.equal((await api('GET', '/api/public/owner-portal/short')).status, 404)
  assert.equal((await api('GET', '/api/public/owner-portal/%3Cscript%3E')).status, 404)

  const root = path.resolve(__dirname, '..')
  const router = fs.readFileSync(path.join(root, 'frontend/src/router/index.ts'), 'utf8')
  const view = fs.readFileSync(path.join(root, 'frontend/src/views/OwnerPortalView.vue'), 'utf8')
  const owners = fs.readFileSync(path.join(root, 'frontend/src/views/OwnersView.vue'), 'utf8')
  assert.match(router, /path: '\/owner-portal\/:token'/)
  assert.match(view, /\/api\/public\/owner-portal\//)
  assert.match(owners, /portal-token\/regenerate/)
  assert.match(owners, /portal-token\/revoke/)
})
