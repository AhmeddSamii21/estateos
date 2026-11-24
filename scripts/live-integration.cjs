/*
 * EstateOS live database integration harness.
 *
 * This script is intentionally separate from the offline `npm test` suite.
 * It creates uniquely named test-only organizations/users, exercises the real
 * Express API against the configured PostgreSQL database, and deletes only the
 * records and local document files that it created itself.
 *
 * Run: npm run test:live
 */
require('dotenv/config')

const assert = require('node:assert/strict')
const { once } = require('node:events')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const { Prisma, PrismaClient, Role } = require('@prisma/client')

// This harness exercises far more endpoints than a normal client session.
// Raise only the in-test request ceiling so activity checks cannot be
// confused by the application's 429 protection.
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'

const prisma = new PrismaClient()
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
const tag = `ITEST-${runId}`
const uploadRoot = path.resolve(process.env.UPLOAD_PATH || path.join(process.cwd(), 'storage', 'documents'))

const results = []
const state = {
  orgAId: null,
  orgBId: null,
  userIds: [],
  passwords: {},
  users: {},
  tokens: {},
  properties: {},
  owners: {},
  leads: {},
  appointments: {},
  deals: {},
  payments: {},
  expenses: {},
  commissions: {},
  document: null,
  maintenance: null,
  storageKeys: [],
  imageStorageKeys: []
}

let apiModule = null
let server = null
let baseUrl = ''

function safeMessage(error) {
  if (!error) return 'Unknown error'
  const message = error && typeof error === 'object' ? String(error.message || error.code || error.name) : String(error)
  return message.replace(/\s+/g, ' ').slice(0, 240)
}

function decimal(value) {
  return new Prisma.Decimal(value)
}

function money(value) {
  return decimal(value).toFixed(2)
}

function rate(value) {
  return decimal(value).toFixed(8)
}

function passwordFor(role) {
  // Never logged or persisted outside process memory.
  return `Itest!${crypto.randomBytes(18).toString('base64url')}`
}

async function startServer() {
  if (!apiModule) {
    const compiled = path.join(__dirname, '..', 'dist-backend', 'index.js')
    try {
      await fs.access(compiled)
    } catch {
      throw new Error('dist-backend/index.js is missing; run npm run build:api first')
    }
    apiModule = require(compiled)
  }
  server = apiModule.default.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
}

async function stopServer() {
  if (!server) return
  const current = server
  server = null
  current.closeAllConnections?.()
  await new Promise((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()))
  })
}

async function api(method, urlPath, options = {}) {
  const headers = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const requestBody = options.form || (options.body !== undefined ? JSON.stringify(options.body) : undefined)
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: requestBody
  })
  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  const defaultExpected = method === 'POST' ? [200, 201] : [200]
  const expected = options.expect === undefined ? defaultExpected : Array.isArray(options.expect) ? options.expect : [options.expect]
  if (!expected.includes(response.status)) {
    const payload = data && typeof data === 'object' ? data : {}
    const detail = typeof payload.error === 'object'
      ? payload.error?.message
      : payload.error || payload.message || payload
    throw new Error(`Expected ${expected.join('/')} from ${method} ${urlPath}, got ${response.status}: ${safeMessage(detail)}`)
  }
  return { status: response.status, data, headers: response.headers }
}

async function rawDownload(urlPath, options = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    headers: options.token ? { Authorization: `Bearer ${options.token}` } : {}
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  const expected = options.expect === undefined ? [200] : Array.isArray(options.expect) ? options.expect : [options.expect]
  if (!expected.includes(response.status)) {
    const text = buffer.toString('utf8').slice(0, 300)
    throw new Error(`Expected ${expected.join('/')} from download, got ${response.status}: ${safeMessage(text)}`)
  }
  return { status: response.status, buffer, headers: response.headers }
}

async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, status: 'PASS' })
    console.log(`PASS ${name}${detail ? ` :: ${detail}` : ''}`)
  } catch (error) {
    results.push({ name, status: 'FAIL' })
    console.log(`FAIL ${name} :: ${safeMessage(error)}`)
  }
}

function requireData(response) {
  const body = response.data
  if (!body || typeof body !== 'object') throw new Error('API response did not contain a data object')
  return Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body
}

function assertNewestFirst(entries) {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]
    const current = entries[index]
    if (previous.timestamp < current.timestamp) {
      throw new Error(`activity out of order: ${previous.timestamp} before ${current.timestamp}`)
    }
    if (previous.timestamp === current.timestamp && previous.id < current.id) {
      throw new Error(`activity tie not id-descending: ${previous.id} before ${current.id}`)
    }
  }
}

async function createFixtures() {
  state.orgAId = (await prisma.organization.create({
    data: {
      name: `${tag} Primary Organization`,
      slug: `${tag.toLowerCase()}-a`,
      currency: 'USD',
      baseCurrency: 'USD'
    },
    select: { id: true }
  })).id

  state.orgBId = (await prisma.organization.create({
    data: {
      name: `${tag} Isolated Organization`,
      slug: `${tag.toLowerCase()}-b`,
      currency: 'USD',
      baseCurrency: 'USD'
    },
    select: { id: true }
  })).id

  const definitions = [
    ['ADMIN', state.orgAId],
    ['MANAGER', state.orgAId],
    ['AGENT', state.orgAId],
    ['ACCOUNTANT', state.orgAId],
    ['AGENT_B', state.orgBId],
    ['ACCOUNTANT_B', state.orgBId]
  ]

  for (const [key, organizationId] of definitions) {
    const role = key.endsWith('_B') ? Role[key.slice(0, -2)] : Role[key]
    const secret = passwordFor(key)
    state.passwords[key] = secret
    const user = await prisma.user.create({
      data: {
        email: `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`,
        password: await bcrypt.hash(secret, 10),
        role,
        organizationId,
        firstName: `ITest ${key}`,
        isActive: true
      },
      select: { id: true, email: true, role: true, organizationId: true }
    })
    state.userIds.push(user.id)
    state.users[key] = user
  }
}

async function login(key) {
  const response = await api('POST', '/api/auth/login', {
    body: { email: state.users[key].email, password: state.passwords[key] }
  })
  const data = requireData(response)
  assert.equal(data.role, state.users[key].role)
  assert.equal(data.organizationId, state.users[key].organizationId)
  assert.ok(data.token, 'login did not return a token')
  assert.ok(!JSON.stringify(data).includes('password'), 'login response contained password data')
  state.tokens[key] = data.token
  return data
}

async function cleanup() {
  const orgIds = [state.orgAId, state.orgBId].filter(Boolean)
  const userIds = [...new Set((state.userIds || []).filter(Boolean))]
  if (orgIds.length === 0 && userIds.length === 0) return

  const organizationFilter = { organizationId: { in: orgIds } }
  const propertyIds = [...new Set(Object.values(state.properties || {}).map((item) => item && item.id).filter(Boolean))]
  const ownerIds = [...new Set(Object.values(state.owners || {}).map((item) => item && item.id).filter(Boolean))]
  const imageStorageKeys = [...new Set((state.imageStorageKeys || []).filter(Boolean))]
  const documentStorageKeys = [...new Set((state.storageKeys || []).filter(Boolean))]

  const removeOwnedFiles = async (keys) => {
    for (const storageKey of keys) {
      try {
        await fs.unlink(path.join(uploadRoot, storageKey))
      } catch {
        // Already absent or non-owned in this run; cleanup remains idempotent.
      }
    }
  }

  // Remove only files recorded as created/uploaded by this test run before DB rows are removed.
  await removeOwnedFiles(documentStorageKeys)
  await removeOwnedFiles(imageStorageKeys)

  // Delete in dependency-safe order, scoped to exact test-run entities/IDs only.
  await prisma.$transaction(async (tx) => {
    // Notification FKs reference User and Organization; remove test-run notifications first.
    await tx.notification.deleteMany({
      where: {
        OR: [
          ...(userIds.length ? [{ userId: { in: userIds } }] : []),
          ...(orgIds.length ? [{ organizationId: { in: orgIds } }] : [])
        ]
      }
    })

    await tx.document.deleteMany({
      where: {
        OR: [
          ...(orgIds.length ? [organizationFilter] : []),
          ...(userIds.length ? [{ uploadedById: { in: userIds } }] : []),
          ...(ownerIds.length ? [{ ownerId: { in: ownerIds } }] : [])
        ]
      }
    })

    await tx.payment.deleteMany({ where: orgIds.length ? { deal: organizationFilter } : { id: { in: [] } } })
    await tx.commission.deleteMany({
      where: {
        OR: [
          ...(orgIds.length ? [{ deal: organizationFilter }] : []),
          ...(userIds.length ? [{ userId: { in: userIds } }] : [])
        ]
      }
    })
    await tx.expense.deleteMany({
      where: {
        OR: [
          ...(orgIds.length ? [{ property: organizationFilter }, { deal: organizationFilter }] : []),
          ...(userIds.length ? [{ responsibleId: { in: userIds } }] : [])
        ]
      }
    })
    await tx.maintenanceRequest.deleteMany({
      where: {
        OR: [
          ...(orgIds.length ? [organizationFilter] : []),
          ...(userIds.length ? [{ assignedToId: { in: userIds } }, { createdById: { in: userIds } }] : []),
          ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : [])
        ]
      }
    })
    await tx.appointment.deleteMany({
      where: {
        OR: [
          ...(orgIds.length ? [{ user: organizationFilter }, { property: organizationFilter }] : []),
          ...(userIds.length ? [{ userId: { in: userIds } }] : []),
          ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : [])
        ]
      }
    })
    await tx.lead.deleteMany({
      where: {
        OR: [
          ...(orgIds.length ? [{ property: organizationFilter }] : []),
          ...(userIds.length ? [{ assignedToId: { in: userIds } }] : []),
          ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : [])
        ]
      }
    })
    await tx.deal.deleteMany({
      where: {
        OR: [
          ...(orgIds.length ? [organizationFilter] : []),
          ...(userIds.length ? [{ userId: { in: userIds } }] : []),
          ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : [])
        ]
      }
    })
    await tx.propertyActivity.deleteMany({
      where: {
        OR: [
          ...(orgIds.length ? [{ property: organizationFilter }] : []),
          ...(userIds.length ? [{ userId: { in: userIds } }] : []),
          ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : [])
        ]
      }
    })
    await tx.propertyImage.deleteMany({
      where: {
        OR: [
          ...(orgIds.length ? [{ property: organizationFilter }] : []),
          ...(userIds.length ? [{ uploadedById: { in: userIds } }] : []),
          ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : [])
        ]
      }
    })
    await tx.propertyDocument.deleteMany({
      where: {
        OR: [
          ...(orgIds.length ? [{ property: organizationFilter }] : []),
          ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : [])
        ]
      }
    })
    await tx.property.deleteMany({
      where: {
        OR: [
          ...(orgIds.length ? [organizationFilter] : []),
          ...(propertyIds.length ? [{ id: { in: propertyIds } }] : []),
          ...(ownerIds.length ? [{ ownerId: { in: ownerIds } }] : [])
        ]
      }
    })

    if (ownerIds.length) {
      await tx.owner.deleteMany({ where: { id: { in: ownerIds } } })
    }

    // Package 22: webhook deliveries reference endpoints and organizations;
    // remove them before endpoints and users are deleted.
    await tx.webhookDelivery.deleteMany({ where: orgIds.length ? organizationFilter : { id: { in: [] } } })
    await tx.webhookEndpoint.deleteMany({ where: orgIds.length ? organizationFilter : { id: { in: [] } } })

    await tx.settings.deleteMany({ where: orgIds.length ? organizationFilter : { id: { in: [] } } })
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          ...(userIds.length ? [{ userId: { in: userIds } }] : [])
        ]
      }
    })

    if (userIds.length) {
      await tx.user.deleteMany({ where: { id: { in: userIds } } })
    }
    if (orgIds.length) {
      await tx.organization.deleteMany({ where: { id: { in: orgIds } } })
    }
  })
}

async function verifyCleanup() {
  const orgIds = [state.orgAId, state.orgBId].filter(Boolean)
  const userIds = [...new Set((state.userIds || []).filter(Boolean))]
  const propertyIds = [...new Set(Object.values(state.properties || {}).map((item) => item && item.id).filter(Boolean))]
  const ownerIds = [...new Set(Object.values(state.owners || {}).map((item) => item && item.id).filter(Boolean))]
  if (orgIds.length === 0 && userIds.length === 0 && propertyIds.length === 0 && ownerIds.length === 0) return

  const [users, properties, deals, documents, organizations, notifications, propertyImages, owners] = await Promise.all([
    userIds.length ? prisma.user.count({ where: { id: { in: userIds } } }) : Promise.resolve(0),
    orgIds.length || propertyIds.length ? prisma.property.count({ where: { OR: [...(orgIds.length ? [{ organizationId: { in: orgIds } }] : []), ...(propertyIds.length ? [{ id: { in: propertyIds } }] : [])] } }) : Promise.resolve(0),
    orgIds.length ? prisma.deal.count({ where: { organizationId: { in: orgIds } } }) : Promise.resolve(0),
    orgIds.length ? prisma.document.count({ where: { organizationId: { in: orgIds } } }) : Promise.resolve(0),
    orgIds.length ? prisma.organization.count({ where: { id: { in: orgIds } } }) : Promise.resolve(0),
    userIds.length || orgIds.length ? prisma.notification.count({ where: { OR: [...(userIds.length ? [{ userId: { in: userIds } }] : []), ...(orgIds.length ? [{ organizationId: { in: orgIds } }] : [])] } }) : Promise.resolve(0),
    propertyIds.length || orgIds.length ? prisma.propertyImage.count({ where: { OR: [...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : []), ...(orgIds.length ? [{ property: { organizationId: { in: orgIds } } }] : [])] } }) : Promise.resolve(0),
    ownerIds.length ? prisma.owner.count({ where: { id: { in: ownerIds } } }) : Promise.resolve(0)
  ])

  assert.deepEqual(
    { users, properties, deals, documents, organizations, notifications, propertyImages, owners },
    { users: 0, properties: 0, deals: 0, documents: 0, organizations: 0, notifications: 0, propertyImages: 0, owners: 0 }
  )
}

async function main() {
  console.log(`LIVE_INTEGRATION_RUN=${tag}`)
  await createFixtures()
  await startServer()

  console.log('--- AUTHENTICATION ---')
  await check('auth.health', async () => {
    const response = await api('GET', '/health')
    assert.equal(response.data.status, 'OK')
    return 'health OK'
  })

  await check('auth.login_admin', async () => {
    const data = await login('ADMIN')
    return `role=${data.role}`
  })

  await check('auth.invalid_credentials', async () => {
    const response = await api('POST', '/api/auth/login', {
      body: { email: state.users.ADMIN.email, password: 'DefinitelyNotThePassword' },
      expect: 401
    })
    assert.equal(response.data?.error?.message, 'Invalid credentials')
    return '401 Invalid credentials'
  })

  await check('auth.protected_route_without_token', async () => {
    await api('GET', '/api/auth/me', { expect: 401 })
    return '401 no token'
  })

  await check('auth.malformed_token_rejected', async () => {
    await api('GET', '/api/auth/me', { token: 'not-a-jwt', expect: 401 })
    return '401 malformed token'
  })

  await check('auth.forged_token_rejected', async () => {
    const forged = jwt.sign(
      { id: state.users.ADMIN.id, email: state.users.ADMIN.email, role: 'ADMIN', organizationId: state.orgAId },
      crypto.randomBytes(32).toString('hex')
    )
    await api('GET', '/api/auth/me', { token: forged, expect: 401 })
    return '401 forged signature'
  })

  await check('auth.me_with_valid_token', async () => {
    const data = requireData(await api('GET', '/api/auth/me', { token: state.tokens.ADMIN }))
    assert.equal(data.id, state.users.ADMIN.id)
    assert.ok(!JSON.stringify(data).includes('password'))
    return `user=${data.email}`
  })

  await check('auth.logout_and_stateless_session', async () => {
    const logout = await api('POST', '/api/auth/logout')
    assert.equal(logout.data.success, true)
    const after = await api('GET', '/api/auth/me', { token: state.tokens.ADMIN })
    assert.equal(requireData(after).id, state.users.ADMIN.id)
    return 'logout OK; token remains valid (stateless, no server revocation)'
  })

  for (const key of ['MANAGER', 'AGENT', 'ACCOUNTANT', 'AGENT_B', 'ACCOUNTANT_B']) {
    await check(`auth.login_${key.toLowerCase()}`, async () => {
      const data = await login(key)
      return `role=${data.role}`
    })
  }

  console.log('--- PROPERTIES ---')
  const propertyPayload = (suffix, overrides = {}) => ({
    referenceNumber: `${tag}-P${suffix}`,
    title: `${tag} Property ${suffix}`,
    description: `${tag} live integration fixture`,
    type: suffix === '2' ? 'APARTMENT' : 'HOUSE',
    status: 'AVAILABLE',
    classification: 'SALE',
    address: `${suffix} Test Street`,
    city: suffix === '2' ? 'Otherville' : 'Testville',
    country: 'Testland',
    latitude: suffix === '3' ? undefined : 40.7128 + Number(suffix) / 10000,
    longitude: suffix === '3' ? undefined : -74.006 - Number(suffix) / 10000,
    area: 100 + Number(suffix),
    bedrooms: suffix === '2' ? 1 : 3,
    bathrooms: 2,
    price: suffix === '2' ? '120000.00' : suffix === '3' ? '900000.00' : '250000.00',
    currency: 'USD',
    assignedAgentId: suffix === '2' ? state.users.MANAGER.id : state.users.AGENT.id,
    featured: suffix === '1'
  })

  await check('properties.create', async () => {
    for (const suffix of ['1', '2', '3', '4']) {
      const data = requireData(await api('POST', '/api/properties', {
        token: state.tokens.ADMIN,
        body: propertyPayload(suffix)
      }))
      state.properties[suffix] = data
    }
    return 'created P1..P4'
  })

  await check('properties.read_list_and_detail', async () => {
    const list = await api('GET', '/api/properties?limit=10', { token: state.tokens.ADMIN })
    assert.ok(list.data.data.some((item) => item.id === state.properties['1'].id))
    const detail = requireData(await api('GET', `/api/properties/${state.properties['1'].id}`, { token: state.tokens.ADMIN }))
    assert.equal(detail.title, `${tag} Property 1`)
    assert.equal(detail.assignedAgent.id, state.users.AGENT.id)
    assert.equal(detail.activities[0].action, 'PROPERTY_CREATED')
    return `listTotal=${list.data.pagination.total}`
  })

  await check('properties.update', async () => {
    const data = requireData(await api('PATCH', `/api/properties/${state.properties['1'].id}`, {
      token: state.tokens.ADMIN,
      body: { title: `${tag} Property 1 Updated`, price: '260000.00' }
    }))
    assert.equal(data.title, `${tag} Property 1 Updated`)
    assert.equal(money(data.price), '260000.00')
    return 'title and price persisted'
  })

  await check('properties.status_transitions', async () => {
    const reserved = requireData(await api('PATCH', `/api/properties/${state.properties['1'].id}/status`, {
      token: state.tokens.ADMIN,
      body: { status: 'RESERVED' }
    }))
    assert.equal(reserved.status, 'RESERVED')
    assert.ok(reserved.reservedUntil, 'RESERVED did not set reservedUntil')
    const sold = requireData(await api('PATCH', `/api/properties/${state.properties['1'].id}/status`, {
      token: state.tokens.ADMIN,
      body: { status: 'SOLD' }
    }))
    assert.equal(sold.status, 'SOLD')
    return 'AVAILABLE -> RESERVED -> SOLD'
  })

  await check('properties.invalid_status_transition', async () => {
    const response = await api('PATCH', `/api/properties/${state.properties['1'].id}/status`, {
      token: state.tokens.ADMIN,
      body: { status: 'AVAILABLE' },
      expect: 400
    })
    assert.match(String(response.data?.error?.message), /Invalid property status transition/)
    return 'SOLD -> AVAILABLE rejected'
  })

  await check('properties.archive_is_non_destructive', async () => {
    await api('DELETE', `/api/properties/${state.properties['4'].id}`, { token: state.tokens.ADMIN })
    const archived = await prisma.property.findUnique({
      where: { id: state.properties['4'].id },
      select: { isActive: true, deletedAt: true }
    })
    assert.equal(archived.isActive, false)
    assert.ok(archived.deletedAt, 'deletedAt was not set')
    await api('GET', `/api/properties/${state.properties['4'].id}`, { token: state.tokens.ADMIN, expect: 404 })
    const list = await api('GET', `/api/properties?search=${encodeURIComponent(tag)}-P4`, { token: state.tokens.ADMIN })
    assert.equal(list.data.pagination.total, 0)
    return 'row retained, hidden from API'
  })

  console.log('--- CRM ---')
  await check('crm.lead_crud_and_assignment', async () => {
    const created = requireData(await api('POST', '/api/leads', {
      token: state.tokens.AGENT,
      body: {
        firstName: `${tag} Lead`,
        lastName: 'One',
        email: `${tag.toLowerCase()}.lead@example.invalid`,
        phone: '5550100',
        status: 'NEW',
        source: 'IntegrationTest',
        notes: `${tag} lead fixture`,
        assignedToId: state.users.AGENT.id,
        propertyId: state.properties['1'].id
      }
    }))
    state.leads.one = created
    assert.equal(created.assignedToId, state.users.AGENT.id)

    const list = await api('GET', `/api/leads?search=${encodeURIComponent(tag)}&limit=10`, { token: state.tokens.AGENT })
    assert.ok(list.data.data.some((item) => item.id === created.id))

    const detail = requireData(await api('GET', `/api/leads/${created.id}`, { token: state.tokens.AGENT }))
    assert.equal(detail.firstName, `${tag} Lead`)

    const updated = requireData(await api('PATCH', `/api/leads/${created.id}`, {
      token: state.tokens.AGENT,
      body: { status: 'QUALIFIED', notes: `${tag} followed up`, assignedToId: state.users.AGENT.id }
    }))
    assert.equal(updated.status, 'QUALIFIED')
    assert.match(updated.notes, /followed up/)
    return 'create/list/read/update/assignment verified'
  })

  await check('crm.appointment_creation_and_follow_up', async () => {
    const startsAt = new Date(Date.now() + 86400000).toISOString()
    const endsAt = new Date(Date.now() + 86400000 + 1800000).toISOString()
    const created = requireData(await api('POST', '/api/appointments', {
      token: state.tokens.AGENT,
      body: {
        title: `${tag} Viewing`,
        type: 'VIEWING',
        startsAt,
        endsAt,
        notes: `${tag} appointment fixture`,
        userId: state.users.AGENT.id,
        propertyId: state.properties['1'].id,
        leadId: state.leads.one.id
      }
    }))
    state.appointments.one = created

    const detail = requireData(await api('GET', `/api/appointments/${created.id}`, { token: state.tokens.AGENT }))
    assert.equal(detail.leadId, state.leads.one.id)

    const updated = requireData(await api('PATCH', `/api/appointments/${created.id}`, {
      token: state.tokens.AGENT,
      body: { status: 'COMPLETED', notes: `${tag} appointment completed` }
    }))
    assert.equal(updated.status, 'COMPLETED')

    const list = await api('GET', '/api/appointments?status=COMPLETED&limit=50', { token: state.tokens.AGENT })
    assert.ok(list.data.data.some((item) => item.id === created.id))
    return 'create/read/status update/list verified'
  })

  // Reset the per-process rate limiter without changing application configuration.
  await stopServer()
  await startServer()

  console.log('--- DEALS AND FINANCE ---')
  await check('deals.create_with_fx_snapshot', async () => {
    const first = requireData(await api('POST', '/api/deals', {
      token: state.tokens.AGENT,
      body: {
        referenceNumber: `${tag}-D1`,
        propertyId: state.properties['1'].id,
        leadId: state.leads.one.id,
        userId: state.users.AGENT.id,
        amount: '100000.00',
        currency: 'EUR',
        exchangeRate: '1.12345678',
        status: 'DRAFT',
        notes: `${tag} primary deal`
      }
    }))
    const second = requireData(await api('POST', '/api/deals', {
      token: state.tokens.MANAGER,
      body: {
        referenceNumber: `${tag}-D2`,
        propertyId: state.properties['2'].id,
        userId: state.users.MANAGER.id,
        amount: '50000.00',
        currency: 'EUR',
        exchangeRate: '1.25000000',
        status: 'PENDING',
        notes: `${tag} secondary deal`
      }
    }))
    state.deals.one = first
    state.deals.two = second
    assert.equal(money(first.baseAmount), '112345.68')
    assert.equal(rate(first.exchangeRate), '1.12345678')
    assert.equal(money(second.baseAmount), '62500.00')
    return 'D1 base=112345.68, D2 base=62500.00'
  })

  await check('deals.status_changes_and_validation', async () => {
    for (const status of ['PENDING', 'ACTIVE', 'COMPLETED']) {
      const data = requireData(await api('PATCH', `/api/deals/${state.deals.one.id}`, {
        token: state.tokens.AGENT,
        body: { status }
      }))
      assert.equal(data.status, status)
    }
    const response = await api('PATCH', `/api/deals/${state.deals.one.id}`, {
      token: state.tokens.AGENT,
      body: { status: 'ACTIVE' },
      expect: 400
    })
    assert.match(String(response.data?.error?.message), /Invalid deal status transition/)
    return 'DRAFT -> PENDING -> ACTIVE -> COMPLETED; invalid transition rejected'
  })

  await check('deals.read_and_agent_scope', async () => {
    const detail = requireData(await api('GET', `/api/deals/${state.deals.one.id}`, { token: state.tokens.AGENT }))
    assert.ok(detail.auditTrail.some((row) => row.action === 'DEAL_CREATED'))
    const list = await api('GET', `/api/deals?search=${encodeURIComponent(tag)}&limit=10`, { token: state.tokens.MANAGER })
    assert.ok(list.data.data.some((item) => item.id === state.deals.one.id))
    await api('GET', `/api/deals/${state.deals.two.id}`, { token: state.tokens.AGENT, expect: 403 })
    return 'detail/list verified; agent denied other-assigned deal'
  })

  await check('finance.payments_and_outstanding_balance', async () => {
    const completed = requireData(await api('POST', '/api/finance/payments', {
      token: state.tokens.ACCOUNTANT,
      body: {
        dealId: state.deals.one.id,
        amount: '30000.00',
        currency: 'EUR',
        exchangeRate: '1.20000000',
        status: 'COMPLETED',
        method: 'BANK',
        reference: `${tag}-PAY-1`
      }
    }))
    const pending = requireData(await api('POST', '/api/finance/payments', {
      token: state.tokens.ACCOUNTANT,
      body: {
        dealId: state.deals.one.id,
        amount: '10000.00',
        currency: 'USD',
        status: 'PENDING',
        reference: `${tag}-PAY-2`
      }
    }))
    state.payments.completed = completed
    state.payments.pending = pending
    assert.equal(money(completed.baseAmount), '36000.00')
    assert.equal(rate(completed.exchangeRate), '1.20000000')
    assert.equal(money(pending.baseAmount), '10000.00')

    await api('POST', '/api/finance/payments', {
      token: state.tokens.ACCOUNTANT,
      body: {
        dealId: state.deals.one.id,
        amount: '1.00',
        currency: 'USD',
        reference: `${tag}-PAY-1`
      },
      expect: 409
    })

    const summary = requireData(await api('GET', `/api/finance/payments/summary?dealId=${state.deals.one.id}`, {
      token: state.tokens.ACCOUNTANT
    }))
    assert.equal(summary.dealBaseAmount, '112345.68')
    assert.equal(summary.received, '36000.00')
    assert.equal(summary.outstanding, '76345.68')
    assert.equal(summary.payments, 2)
    return 'received=36000.00 outstanding=76345.68; duplicate reference 409'
  })

  await check('finance.expenses_and_decimal_conversion', async () => {
    const created = requireData(await api('POST', '/api/finance/expenses', {
      token: state.tokens.MANAGER,
      body: {
        dealId: state.deals.one.id,
        propertyId: state.properties['1'].id,
        responsibleId: state.users.MANAGER.id,
        category: 'Repair',
        description: `${tag} expense fixture`,
        amount: '1250.75',
        currency: 'EUR',
        exchangeRate: '1.10000000',
        status: 'PAID'
      }
    }))
    state.expenses.one = created
    const expectedBase = decimal('1250.75').times('1.10000000').toDecimalPlaces(2).toFixed(2)
    assert.equal(money(created.baseAmount), expectedBase)
    const list = await api('GET', `/api/finance/expenses?dealId=${state.deals.one.id}&limit=10`, { token: state.tokens.ACCOUNTANT })
    assert.ok(list.data.data.some((item) => item.id === created.id))
    return `expense base=${expectedBase}`
  })

  await check('finance.commissions_rate_precision_and_transitions', async () => {
    const created = requireData(await api('POST', '/api/finance/commissions', {
      token: state.tokens.ACCOUNTANT,
      body: {
        dealId: state.deals.one.id,
        userId: state.users.AGENT.id,
        rate: '0.02500000',
        currency: 'EUR',
        exchangeRate: '1.20000000',
        notes: `${tag} commission fixture`
      }
    }))
    state.commissions.one = created
    assert.equal(money(created.amount), '2500.00')
    assert.equal(rate(created.rate), '0.02500000')
    assert.equal(money(created.baseAmount), '3000.00')

    const approved = requireData(await api('PATCH', `/api/finance/commissions/${created.id}`, {
      token: state.tokens.ACCOUNTANT,
      body: { status: 'APPROVED' }
    }))
    assert.equal(approved.status, 'APPROVED')
    assert.ok(approved.approvedAt)
    const paid = requireData(await api('PATCH', `/api/finance/commissions/${created.id}`, {
      token: state.tokens.ACCOUNTANT,
      body: { status: 'PAID', paymentReference: `${tag}-COMM-PAID` }
    }))
    assert.equal(paid.status, 'PAID')
    assert.ok(paid.paidAt)
    await api('PATCH', `/api/finance/commissions/${created.id}`, {
      token: state.tokens.ACCOUNTANT,
      body: { status: 'APPROVED' },
      expect: 400
    })
    return 'rate=0.02500000 amount=2500.00 base=3000.00; PENDING->APPROVED->PAID'
  })

  await check('finance.historical_fx_snapshots_persisted', async () => {
    const [dealOne, dealTwo, payment, expense, commission] = await Promise.all([
      prisma.deal.findUnique({ where: { id: state.deals.one.id } }),
      prisma.deal.findUnique({ where: { id: state.deals.two.id } }),
      prisma.payment.findUnique({ where: { id: state.payments.completed.id } }),
      prisma.expense.findUnique({ where: { id: state.expenses.one.id } }),
      prisma.commission.findUnique({ where: { id: state.commissions.one.id } })
    ])
    assert.equal(rate(dealOne.exchangeRate), '1.12345678')
    assert.equal(money(dealOne.baseAmount), '112345.68')
    assert.equal(rate(dealTwo.exchangeRate), '1.25000000')
    assert.equal(money(dealTwo.baseAmount), '62500.00')
    assert.equal(rate(payment.exchangeRate), '1.20000000')
    assert.equal(money(payment.baseAmount), '36000.00')
    assert.equal(rate(expense.exchangeRate), '1.10000000')
    assert.equal(rate(commission.rate), '0.02500000')
    return 'two deal rates plus payment/expense/commission rates stored independently'
  })

  console.log('--- DOCUMENTS ---')
  await check('documents.upload_and_metadata', async () => {
    const form = new FormData()
    form.append('file', new Blob([`${tag} document content`], { type: 'text/plain' }), `${tag} proof.txt`)
    form.append('name', `${tag} Proof`)
    form.append('category', 'CONTRACT')
    form.append('description', `${tag} document metadata fixture`)
    form.append('propertyId', state.properties['1'].id)
    form.append('dealId', state.deals.one.id)
    const response = await api('POST', '/api/documents', { token: state.tokens.AGENT, form })
    const document = requireData(response)
    state.document = document
    state.storageKeys.push(document.storageKey)
    assert.equal(document.originalName, `${tag} proof.txt`)
    assert.equal(document.mimeType, 'text/plain')
    assert.equal(document.size, Buffer.byteLength(`${tag} document content`))
    assert.match(document.storageKey, /^[a-f0-9-]{36}\.txt$/i)
    assert.ok(!document.storageKey.includes(tag), 'storage key leaked the original name')

    const persisted = await prisma.document.findUnique({ where: { id: document.id } })
    assert.equal(persisted.category, 'CONTRACT')
    assert.equal(persisted.status, 'ACTIVE')
    return `storageKey=${document.storageKey}`
  })

  await check('documents.authorized_download_and_storage_safety', async () => {
    const response = await rawDownload(`/api/documents/${state.document.id}/download`, { token: state.tokens.ADMIN })
    assert.equal(response.buffer.toString('utf8'), `${tag} document content`)
    assert.equal(response.headers.get('content-type'), 'text/plain')
    assert.match(String(response.headers.get('content-disposition') || ''), /attachment/)
    const file = await fs.readFile(path.join(uploadRoot, state.document.storageKey), 'utf8')
    assert.equal(file, `${tag} document content`)
    return 'authenticated download and non-public generated storage key verified'
  })

  await check('documents.unauthorized_download_rejected', async () => {
    await rawDownload(`/api/documents/${state.document.id}/download`, { token: state.tokens.AGENT_B, expect: 404 })
    return 'cross-organization download rejected with 404'
  })

  await check('documents.archive_and_restore', async () => {
    await api('DELETE', `/api/documents/${state.document.id}`, { token: state.tokens.ADMIN })
    const archived = await prisma.document.findUnique({ where: { id: state.document.id } })
    assert.equal(archived.status, 'ARCHIVED')
    assert.ok(archived.deletedAt === null, 'archive unexpectedly set deletedAt')
    const defaultList = await api('GET', `/api/documents?search=${encodeURIComponent(tag)}`, { token: state.tokens.ADMIN })
    assert.equal(defaultList.data.pagination.total, 0)
    const archivedList = await api('GET', `/api/documents?search=${encodeURIComponent(tag)}&status=ARCHIVED`, { token: state.tokens.ADMIN })
    assert.ok(archivedList.data.data.some((item) => item.id === state.document.id))

    const restored = requireData(await api('PATCH', `/api/documents/${state.document.id}`, {
      token: state.tokens.ADMIN,
      body: { status: 'ACTIVE' }
    }))
    assert.equal(restored.status, 'ACTIVE')
    const fileStillPresent = await fs.stat(path.join(uploadRoot, state.document.storageKey))
    assert.ok(fileStillPresent.isFile())
    return 'archived row and file retained; restored through PATCH'
  })

  console.log('--- PROPERTY OPERATIONS ---')
  await check('maintenance.create_assign_and_status_history', async () => {
    const created = requireData(await api('POST', '/api/maintenance', {
      token: state.tokens.MANAGER,
      body: {
        propertyId: state.properties['1'].id,
        title: `${tag} Maintenance`,
        description: `${tag} maintenance fixture`,
        priority: 'HIGH',
        assignedToId: state.users.AGENT.id,
        cost: '450.25',
        currency: 'USD'
      }
    }))
    state.maintenance = created
    assert.equal(created.assignedToId, state.users.AGENT.id)

    const detail = requireData(await api('GET', `/api/maintenance/${created.id}`, { token: state.tokens.AGENT }))
    assert.equal(detail.title, `${tag} Maintenance`)

    const inProgress = requireData(await api('PATCH', `/api/maintenance/${created.id}`, {
      token: state.tokens.AGENT,
      body: { status: 'IN_PROGRESS' }
    }))
    assert.equal(inProgress.status, 'IN_PROGRESS')
    const completed = requireData(await api('PATCH', `/api/maintenance/${created.id}`, {
      token: state.tokens.AGENT,
      body: { status: 'COMPLETED' }
    }))
    assert.equal(completed.status, 'COMPLETED')
    assert.ok(completed.completedAt)

    const property = requireData(await api('GET', `/api/properties/${state.properties['1'].id}`, { token: state.tokens.ADMIN }))
    const actions = property.activities.map((item) => item.action)
    assert.ok(actions.includes('MAINTENANCE_CREATED'))
    assert.ok(actions.includes('MAINTENANCE_STATUS_CHANGED'))
    return 'OPEN -> IN_PROGRESS -> COMPLETED; activity history verified'
  })

  // Reset the per-process rate limiter before the activity suite.
  await stopServer()
  await startServer()

  console.log('--- ACTIVITY TIMELINE ---')
  await check('activity.unauthenticated_rejected', async () => {
    await api('GET', '/api/activity', { expect: 401 })
    await api('GET', `/api/activity/Property/${state.properties['1'].id}`, { expect: 401 })
    return '401 for global and entity timelines'
  })

  await check('activity.global_persisted_records', async () => {
    const response = await api('GET', '/api/activity?entityType=Property&limit=50', { token: state.tokens.ADMIN })
    const entries = response.data.data
    assert.ok(entries.some((entry) => entry.action === 'PROPERTY_CREATED'))
    assert.ok(entries.some((entry) => entry.action === 'PROPERTY_UPDATED'))
    assert.ok(entries.some((entry) => entry.action === 'PROPERTY_STATUS_CHANGED'))
    for (const entry of entries) {
      assert.equal(entry.entityType, 'Property')
      assert.ok(entry.entity.label, 'entity label is missing')
      assert.ok(entry.actor?.email || entry.actor === null, 'actor is not safe')
      assert.ok(entry.timestamp, 'timestamp is missing')
    }
    assertNewestFirst(entries)
    return `${entries.length} persisted property events`
  })

  await check('activity.organization_isolation', async () => {
    const otherOrg = await api('GET', '/api/activity?limit=100', { token: state.tokens.ACCOUNTANT_B })
    assert.equal(otherOrg.data.data.length, 0)
    await api('GET', `/api/activity/Property/${state.properties['1'].id}`, { token: state.tokens.ACCOUNTANT_B, expect: 404 })
    await api('GET', `/api/activity/Deal/${state.deals.one.id}`, { token: state.tokens.AGENT_B, expect: 404 })
    return 'other organization sees no events and cannot read entity timelines'
  })

  await check('activity.agent_restrictions', async () => {
    const own = await api('GET', `/api/activity/Property/${state.properties['1'].id}?limit=20`, { token: state.tokens.AGENT })
    assert.ok(own.data.data.length > 0)
    await api('GET', `/api/activity/Property/${state.properties['2'].id}`, { token: state.tokens.AGENT, expect: 404 })
    await api('GET', `/api/activity/Deal/${state.deals.two.id}`, { token: state.tokens.AGENT, expect: 404 })
    await api('GET', '/api/activity?entityType=Payment', { token: state.tokens.AGENT, expect: 403 })
    const globalAgent = await api('GET', '/api/activity?limit=100', { token: state.tokens.AGENT })
    assert.ok(!globalAgent.data.data.some((entry) => ['Payment', 'Expense', 'Commission'].includes(entry.entityType)))
    return 'assigned entities readable; unassigned, finance, and cross-org entities denied'
  })

  await check('activity.filters_and_validation', async () => {
    const from = new Date(Date.now() - 30 * 86400000).toISOString()
    const to = new Date(Date.now() + 86400000).toISOString()
    const params = `entityType=Lead&action=LEAD_UPDATED&userId=${state.users.AGENT.id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    const response = await api('GET', `/api/activity?${params}`, { token: state.tokens.ADMIN })
    assert.ok(response.data.data.length > 0)
    for (const entry of response.data.data) {
      assert.equal(entry.entityType, 'Lead')
      assert.equal(entry.action, 'LEAD_UPDATED')
      assert.equal(entry.actor.id, state.users.AGENT.id)
      assert.ok(entry.timestamp >= from && entry.timestamp <= to)
    }
    await api('GET', '/api/activity?entityType=Nope', { token: state.tokens.ADMIN, expect: 400 })
    await api('GET', '/api/activity?from=2026-02-01&to=2026-01-01', { token: state.tokens.ADMIN, expect: 400 })
    await api('GET', '/api/activity?cursor=not-a-cursor', { token: state.tokens.ADMIN, expect: 400 })
    return 'entity/action/user/date filters applied; invalid inputs rejected'
  })

  await check('activity.global_cursor_pagination', async () => {
    const first = await api('GET', '/api/activity?entityType=Property&limit=2', { token: state.tokens.ADMIN })
    assert.equal(first.data.data.length, 2)
    assert.ok(first.data.nextCursor, 'nextCursor missing')
    const cursor = encodeURIComponent(first.data.nextCursor)
    const second = await api('GET', `/api/activity?entityType=Property&limit=2&cursor=${cursor}`, { token: state.tokens.ADMIN })
    const firstIds = new Set(first.data.data.map((entry) => entry.id))
    assert.ok(second.data.data.length > 0)
    assert.ok(!second.data.data.some((entry) => firstIds.has(entry.id)), 'pages overlap')
    assertNewestFirst([...first.data.data, ...second.data.data])
    return `cursor advanced ${first.data.data[0].id} -> ${second.data.data[0].id}`
  })

  await check('activity.entity_pagination_and_ordering', async () => {
    const base = `/api/activity/Property/${state.properties['1'].id}`
    const first = await api('GET', `${base}?limit=2&page=1`, { token: state.tokens.ADMIN })
    const second = await api('GET', `${base}?limit=2&page=2`, { token: state.tokens.ADMIN })
    assert.ok(first.data.pagination.total >= 3)
    assert.equal(first.data.pagination.limit, 2)
    assert.equal(first.data.data.length, 2)
    const firstIds = new Set(first.data.data.map((entry) => entry.id))
    assert.ok(!second.data.data.some((entry) => firstIds.has(entry.id)), 'entity pages overlap')
    assertNewestFirst([...first.data.data, ...second.data.data])
    return `total=${first.data.pagination.total} pages=${first.data.pagination.pages}`
  })

  await check('activity.sensitive_metadata_removed', async () => {
    const marker = `${tag}-SENSITIVE-MARKER`
    await prisma.auditLog.create({
      data: {
        userId: state.users.ADMIN.id,
        action: 'ACTIVITY_SANITIZER_PROBE',
        entityType: 'Property',
        entityId: state.properties['1'].id,
        details: JSON.stringify({
          password: marker,
          storageKey: marker,
          apiKey: marker,
          before: { status: 'DRAFT', assignedAgentId: 'old-agent' },
          after: { status: 'ACTIVE', assignedAgentId: 'new-agent' }
        })
      }
    })
    const response = await api('GET', `/api/activity/Property/${state.properties['1'].id}?limit=100`, { token: state.tokens.ADMIN })
    const serialized = JSON.stringify(response.data)
    assert.ok(!serialized.includes(marker), 'sensitive audit metadata leaked')
    const probe = response.data.data.find((entry) => entry.action === 'ACTIVITY_SANITIZER_PROBE')
    assert.ok(probe, 'probe event was not returned')
    const fields = probe.changes.map((change) => change.field)
    assert.ok(fields.includes('status') && fields.includes('assignedAgentId'), 'object pairs were not expanded faithfully')
    assert.equal(probe.changes.find((change) => change.field === 'assignedAgentId').before, 'old-agent')
    return 'password/storageKey/apiKey removed; real before/after fields preserved'
  })

  await check('activity.safe_entity_links', async () => {
    const allowed = /^\/(properties|deals|finance|appointments|maintenance|documents)(\/|$)/
    const responses = await Promise.all([
      api('GET', `/api/activity/Property/${state.properties['4'].id}?limit=20`, { token: state.tokens.ADMIN }),
      api('GET', `/api/activity/Deal/${state.deals.one.id}?limit=20`, { token: state.tokens.ADMIN })
    ])
    const entries = responses.flatMap((response) => response.data.data)
    for (const entry of entries) {
      if (entry.entity.href === null) continue
      assert.match(entry.entity.href, allowed)
      assert.ok(!entry.entity.href.includes(tag), 'test tag leaked into a link')
    }
    const archived = responses[0].data.data.find((entry) => entry.action === 'PROPERTY_ARCHIVED')
    assert.ok(archived, 'PROPERTY_ARCHIVED event missing')
    assert.equal(archived.entity.href, null, 'archived property produced a dead link')
    return 'links are internal allowlisted paths; archived entities have no link'
  })

  await check('activity.reads_do_not_mutate_records', async () => {
    const before = await Promise.all([
      prisma.property.findUnique({ where: { id: state.properties['1'].id }, select: { updatedAt: true } }),
      prisma.lead.findUnique({ where: { id: state.leads.one.id }, select: { updatedAt: true } }),
      prisma.auditLog.count({ where: { userId: state.users.ADMIN.id } })
    ])
    await api('GET', '/api/activity?limit=100', { token: state.tokens.ADMIN })
    await api('GET', `/api/activity/Lead/${state.leads.one.id}?limit=20`, { token: state.tokens.AGENT })
    const after = await Promise.all([
      prisma.property.findUnique({ where: { id: state.properties['1'].id }, select: { updatedAt: true } }),
      prisma.lead.findUnique({ where: { id: state.leads.one.id }, select: { updatedAt: true } }),
      prisma.auditLog.count({ where: { userId: state.users.ADMIN.id } })
    ])
    assert.equal(after[0].updatedAt.getTime(), before[0].updatedAt.getTime())
    assert.equal(after[1].updatedAt.getTime(), before[1].updatedAt.getTime())
    assert.equal(after[2], before[2])
    return 'business rows and audit count unchanged by reads'
  })

  await check('activity.owner_lead_appointment_logging', async () => {
    const created = requireData(await api('POST', '/api/owners', {
      token: state.tokens.ADMIN,
      body: {
        firstName: `${tag} Owner`,
        companyName: `${tag} Holdings`,
        email: `${tag.toLowerCase()}.owner@example.invalid`,
        isActive: true
      }
    }))
    state.owners.primary = created
    await api('PATCH', `/api/owners/${created.id}`, {
      token: state.tokens.ADMIN,
      body: { city: 'Testville' }
    })
    const ownerEvents = await api('GET', `/api/activity/Owner/${created.id}?limit=20`, { token: state.tokens.ADMIN })
    const ownerActions = ownerEvents.data.data.map((entry) => entry.action)
    assert.ok(ownerActions.includes('OWNER_CREATED'))
    assert.ok(ownerActions.includes('OWNER_UPDATED'))

    const leadEvents = await api('GET', `/api/activity/Lead/${state.leads.one.id}?limit=20`, { token: state.tokens.AGENT })
    const leadActions = leadEvents.data.data.map((entry) => entry.action)
    assert.ok(leadActions.includes('LEAD_CREATED'))
    assert.ok(leadActions.includes('LEAD_UPDATED'))

    const appointmentEvents = await api('GET', `/api/activity/Appointment/${state.appointments.one.id}?limit=20`, { token: state.tokens.AGENT })
    const appointmentActions = appointmentEvents.data.data.map((entry) => entry.action)
    assert.ok(appointmentActions.includes('APPOINTMENT_CREATED'))
    assert.ok(appointmentActions.includes('APPOINTMENT_UPDATED'))
    return 'owner/lead/appointment mutations produced readable audit events'
  })

  await check('activity.existing_module_logging_unchanged', async () => {
    const property = requireData(await api('GET', `/api/properties/${state.properties['1'].id}`, { token: state.tokens.ADMIN }))
    assert.ok(property.activities.some((item) => item.action === 'PROPERTY_CREATED'))
    assert.ok(property.activities.some((item) => item.action === 'PROPERTY_STATUS_CHANGED'))
    const deal = requireData(await api('GET', `/api/deals/${state.deals.one.id}`, { token: state.tokens.ADMIN }))
    assert.ok(deal.auditTrail.some((item) => item.action === 'DEAL_CREATED'))
    const documents = await api('GET', '/api/activity?entityType=Document&action=DOCUMENT_ARCHIVED&limit=20', { token: state.tokens.ADMIN })
    assert.ok(documents.data.data.some((entry) => entry.entityId === state.document.id))
    return 'property activity, deal auditTrail, and document archive logs still present'
  })

  // Reset again so later suites are not affected by activity-suite request volume.
  await stopServer()
  await startServer()

  console.log('--- REPORTS AND ANALYTICS ---')
  await check('reports.real_aggregates_and_date_filter', async () => {
    const from = new Date(Date.now() - 86400000).toISOString()
    const to = new Date(Date.now() + 86400000).toISOString()
    const summary = requireData(await api('GET', `/api/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
      token: state.tokens.ACCOUNTANT
    }))
    assert.equal(summary.properties.total, 3)
    assert.equal(summary.deals.total, 2)
    assert.equal(summary.deals.completed, 1)
    assert.equal(summary.finance.paymentTotalBase, '36000.00')
    assert.equal(summary.finance.expenseTotalBase, money(decimal('1250.75').times('1.10000000').toDecimalPlaces(2)))
    assert.equal(summary.maintenance.totalCost, '450.25')
    return `properties=3 deals=2 payments=36000.00 expenses=${summary.finance.expenseTotalBase}`
  })

  await check('reports.financial_properties_team_views', async () => {
    const financial = requireData(await api('GET', '/api/reports/financial', { token: state.tokens.ADMIN }))
    assert.ok(financial.cashReceived.some((row) => money(row.baseAmount) === '36000.00'))
    const properties = requireData(await api('GET', '/api/reports/properties', { token: state.tokens.ADMIN }))
    assert.ok(properties.activityCount > 0)
    const team = requireData(await api('GET', '/api/reports/team', { token: state.tokens.MANAGER }))
    assert.ok(team.deals.some((row) => row.userId === state.users.AGENT.id))
    return 'financial/properties/team aggregates returned real rows'
  })

  await check('reports.empty_dataset_behavior', async () => {
    const empty = requireData(await api('GET', '/api/reports/summary', { token: state.tokens.ACCOUNTANT_B }))
    assert.equal(empty.properties.total, 0)
    assert.equal(empty.deals.total, 0)
    assert.equal(empty.finance.paymentTotalBase, '0.00')
    const future = new Date(Date.now() + 30 * 86400000).toISOString()
    const filtered = requireData(await api('GET', `/api/reports/summary?from=${encodeURIComponent(future)}`, {
      token: state.tokens.ADMIN
    }))
    assert.equal(filtered.properties.total, 0)
    assert.equal(filtered.deals.total, 0)
    return 'isolated empty org and future-range filter both return zero totals'
  })

  console.log('--- SEARCH AND MAPS ---')
  await check('search.combined_filters_sort_pagination', async () => {
    const filters = '/api/properties?city=Testville&type=HOUSE&minPrice=200000&bedrooms=3&sort=price_desc'
    const response = await api('GET', `${filters}&limit=10`, { token: state.tokens.ADMIN })
    const ids = response.data.data.map((item) => item.id)
    assert.deepEqual(ids, [state.properties['3'].id, state.properties['1'].id])
    assert.equal(response.data.pagination.total, 2)

    const pageOne = await api('GET', `${filters}&limit=1&page=1`, { token: state.tokens.ADMIN })
    const pageTwo = await api('GET', `${filters}&limit=1&page=2`, { token: state.tokens.ADMIN })
    assert.equal(pageOne.data.data[0].id, state.properties['3'].id)
    assert.equal(pageTwo.data.data[0].id, state.properties['1'].id)
    assert.equal(pageOne.data.pagination.pages, 2)
    return 'filters + price_desc + two-page pagination verified'
  })

  await check('search.map_bounds_and_missing_coordinates', async () => {
    const bounds = '/api/properties?minLatitude=40.70&maxLatitude=40.73&minLongitude=-74.03&maxLongitude=-73.99&limit=50'
    const response = await api('GET', bounds, { token: state.tokens.ADMIN })
    const ids = response.data.data.map((item) => item.id)
    assert.ok(ids.includes(state.properties['1'].id))
    assert.ok(ids.includes(state.properties['2'].id))
    assert.ok(!ids.includes(state.properties['3'].id), 'property without coordinates appeared in map bounds')

    const all = await api('GET', `/api/properties?search=${encodeURIComponent(tag)}&limit=50`, { token: state.tokens.ADMIN })
    assert.ok(all.data.data.some((item) => item.id === state.properties['3'].id))
    const dbMissing = await prisma.property.findUnique({
      where: { id: state.properties['3'].id },
      select: { latitude: true, longitude: true }
    })
    assert.equal(dbMissing.latitude, null)
    assert.equal(dbMissing.longitude, null)
    return 'bounded results match coordinates; null-coordinate property excluded but listed normally'
  })

  console.log('--- AUTHORIZATION AND ORGANIZATION ISOLATION ---')
  await check('rbac.agent_cannot_manage_users', async () => {
    await api('POST', '/api/users', {
      token: state.tokens.AGENT,
      body: { email: `${tag.toLowerCase()}-denied@example.invalid`, password: 'AnotherTestPassword1', role: 'ADMIN' },
      expect: 403
    })
    await api('POST', '/api/users', {
      token: state.tokens.ACCOUNTANT,
      body: { email: `${tag.toLowerCase()}-denied2@example.invalid`, password: 'AnotherTestPassword2', role: 'ADMIN' },
      expect: 403
    })
    return 'AGENT and ACCOUNTANT user creation rejected'
  })

  await check('rbac.manager_can_manage_users', async () => {
    const email = `${tag.toLowerCase()}-manager-created@example.invalid`
    const created = requireData(await api('POST', '/api/users', {
      token: state.tokens.MANAGER,
      body: { email, password: passwordFor('MANAGER_CREATED'), role: 'AGENT', firstName: `${tag} Manager Created` }
    }))
    state.userIds.push(created.id)
    assert.equal(created.role, 'AGENT')
    return 'MANAGER created an AGENT in the test organization'
  })

  await check('rbac.role_specific_denials', async () => {
    await api('POST', '/api/finance/expenses', {
      token: state.tokens.AGENT,
      body: { propertyId: state.properties['1'].id, category: 'Denied', amount: '1.00', currency: 'USD' },
      expect: 403
    })
    await api('POST', '/api/maintenance', {
      token: state.tokens.ACCOUNTANT,
      body: { propertyId: state.properties['1'].id, title: `${tag} Denied Maintenance` },
      expect: 403
    })
    await api('GET', '/api/reports/summary', { token: state.tokens.AGENT, expect: 403 })
    return 'AGENT denied finance/reports; ACCOUNTANT denied maintenance creation'
  })

  await check('rbac.agent_property_permissions', async () => {
    await api('PATCH', `/api/properties/${state.properties['2'].id}`, {
      token: state.tokens.AGENT,
      body: { title: `${tag} Illegal Edit` },
      expect: 403
    })
    await api('DELETE', `/api/properties/${state.properties['2'].id}`, {
      token: state.tokens.AGENT,
      expect: 403
    })
    const form = new FormData()
    form.append('file', new Blob(['denied'], { type: 'text/plain' }), `${tag}-denied.txt`)
    form.append('propertyId', state.properties['2'].id)
    await api('POST', '/api/documents', { token: state.tokens.AGENT, form, expect: 403 })
    return 'agent cannot edit/archive unassigned property or attach a document to it'
  })

  await check('isolation.cross_organization_reads_rejected', async () => {
    await api('GET', `/api/properties/${state.properties['1'].id}`, { token: state.tokens.AGENT_B, expect: 404 })
    await api('GET', `/api/deals/${state.deals.one.id}`, { token: state.tokens.AGENT_B, expect: 404 })
    await api('GET', `/api/leads/${state.leads.one.id}`, { token: state.tokens.AGENT_B, expect: 404 })
    const properties = await api('GET', '/api/properties?limit=50', { token: state.tokens.AGENT_B })
    assert.equal(properties.data.pagination.total, 0)
    return 'other organization cannot read primary test records'
  })

  const pass = results.filter((item) => item.status === 'PASS').length
  const fail = results.filter((item) => item.status === 'FAIL').length
  console.log('--- SUMMARY ---')
  console.log(`TESTS=${results.length}`)
  console.log(`PASS=${pass}`)
  console.log(`FAIL=${fail}`)
}

async function run() {
  try {
    await main()
  } catch (error) {
    console.log(`HARNESS_ERROR=${safeMessage(error)}`)
    process.exitCode = 1
  } finally {
    try {
      await stopServer()
    } catch (error) {
      console.log(`SERVER_STOP=FAIL ${safeMessage(error)}`)
    }
    try {
      await cleanup()
      await verifyCleanup()
      console.log('CLEANUP=OK')
    } catch (error) {
      console.log(`CLEANUP=FAIL ${safeMessage(error)}`)
      process.exitCode = 1
    }
    try {
      if (apiModule && typeof apiModule.shutdown === 'function') await apiModule.shutdown()
    } catch {
      // Connection teardown is best-effort after cleanup.
    }
    await prisma.$disconnect().catch(() => {})
    const failed = results.some((item) => item.status === 'FAIL')
    if (failed || process.exitCode) process.exitCode = 1
  }
}

run()
