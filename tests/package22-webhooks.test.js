const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const http = require('node:http')
const bcrypt = require('bcrypt')

// Webhook configuration and pure URL/signature helpers are read at require
// time, so set these before loading the compiled app.
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'
process.env.WEBHOOK_ALLOW_PRIVATE_URLS = 'true'
process.env.WEBHOOK_SIGNING_KEY = 'package22-test-webhook-signing-key'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')
const { checkWebhookUrlConfig, validateWebhookUrl } = require('../dist-backend/utils/webhookUrl.js')
const {
  hashWebhookSecret,
  verifyWebhookSignature
} = require('../dist-backend/utils/webhookSignature.js')

const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG22-${runId}`
const EXPECTED_EVENTS = ['property.created', 'lead.created', 'deal.stage_changed', 'payment.recorded']
const state = {
  orgAId: null,
  orgBId: null,
  users: {},
  tokens: {},
  secrets: {},
  endpoints: {},
  propertyId: null,
  leadId: null,
  dealId: null,
  receiver: null,
  receiverUrl: '',
  received: [],
  failedPort: null
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

async function waitFor(predicate, label, timeout = 8000) {
  const deadline = Date.now() + timeout
  let last = null
  while (Date.now() < deadline) {
    last = await predicate()
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${label}`)
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
  const password = `Package22!${crypto.randomBytes(10).toString('base64url')}`
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
  state.users[key] = user.id
  const login = await api('POST', '/api/auth/login', { body: { email: user.email, password } })
  assert.equal(login.status, 200, `${key} login should succeed`)
  state.tokens[key] = login.data.data.token
}

async function createEndpoint(key, token, url, events) {
  const created = await api('POST', '/api/webhooks/endpoints', {
    token,
    body: { url, events, isActive: true }
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  state.endpoints[key] = created.data.data.id
  state.secrets[key] = created.data.secret
  assert.match(state.secrets[key], /^whsec_/)
  return created
}

test.before(async () => {
  state.receiver = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      state.received.push({
        event: req.headers['x-webhook-event'],
        signature: req.headers['x-webhook-signature'],
        body: Buffer.concat(chunks).toString('utf8')
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  await new Promise((resolve) => state.receiver.listen(0, '127.0.0.1', resolve))
  state.receiverUrl = `http://127.0.0.1:${state.receiver.address().port}/hook`

  // A port that is closed immediately, used to prove failed deliveries are
  // recorded without affecting the triggering business API.
  const deadServer = http.createServer()
  await new Promise((resolve) => deadServer.listen(0, '127.0.0.1', resolve))
  state.failedPort = deadServer.address().port
  await new Promise((resolve) => deadServer.close(resolve))

  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  state.orgAId = await createOrg('a')
  state.orgBId = await createOrg('b')
  await createUser('ADMIN_A', state.orgAId, 'ADMIN')
  await createUser('MANAGER_A', state.orgAId, 'MANAGER')
  await createUser('ADMIN_B', state.orgBId, 'ADMIN')

  await createEndpoint('all', state.tokens.ADMIN_A, state.receiverUrl, EXPECTED_EVENTS)
  await createEndpoint('tenantB', state.tokens.ADMIN_B, state.receiverUrl, EXPECTED_EVENTS)

  const property = await prisma.property.create({
    data: {
      referenceNumber: `${tag}-DEAL-PROP`,
      title: 'Webhook deal property',
      type: 'APARTMENT',
      organizationId: state.orgAId
    },
    select: { id: true }
  })
  state.propertyId = property.id
  const lead = await prisma.lead.create({
    data: {
      firstName: 'Webhook',
      lastName: 'Lead',
      assignedToId: state.users.ADMIN_A,
      propertyId: state.propertyId
    },
    select: { id: true }
  })
  state.leadId = lead.id
  const deal = await prisma.deal.create({
    data: {
      referenceNumber: `${tag}-DEAL`,
      organizationId: state.orgAId,
      userId: state.users.ADMIN_A,
      propertyId: state.propertyId,
      leadId: state.leadId,
      status: 'DRAFT',
      amount: '1000.00'
    },
    select: { id: true }
  })
  state.dealId = deal.id
})

test.after(async () => {
  try {
    const orgIds = [state.orgAId, state.orgBId].filter(Boolean)
    if (orgIds.length) {
      const userIds = await prisma.user.findMany({
        where: { organizationId: { in: orgIds } },
        select: { id: true }
      }).then((users) => users.map((user) => user.id))
      await prisma.$transaction(async (tx) => {
        await tx.webhookDelivery.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.webhookEndpoint.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.notification.deleteMany({
          where: {
            OR: [
              { userId: { in: userIds } },
              { organizationId: { in: orgIds } }
            ]
          }
        })
        await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })
        await tx.payment.deleteMany({ where: { deal: { organizationId: { in: orgIds } } } })
        await tx.deal.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.lead.deleteMany({
          where: {
            OR: [
              { property: { organizationId: { in: orgIds } } },
              { assignedToId: { in: userIds } }
            ]
          }
        })
        await tx.property.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } })
      })
    }
  } finally {
    if (state.receiver) await new Promise((resolve) => state.receiver.close(resolve))
    await shutdown()
  }
})

test('webhook configuration is admin-only, tenant scoped and validates the event whitelist', async () => {
  const managerList = await api('GET', '/api/webhooks/endpoints', { token: state.tokens.MANAGER_A })
  assert.equal(managerList.status, 403)
  const managerCreate = await api('POST', '/api/webhooks/endpoints', {
    token: state.tokens.MANAGER_A,
    body: { url: state.receiverUrl, events: ['property.created'] }
  })
  assert.equal(managerCreate.status, 403)

  const listed = await api('GET', '/api/webhooks/endpoints', { token: state.tokens.ADMIN_A })
  assert.equal(listed.status, 200, JSON.stringify(listed.data))
  assert.equal(listed.data.data.length, 1)
  assert.ok(!JSON.stringify(listed.data).includes('secret'))
  assert.ok(!JSON.stringify(listed.data).includes('secretHash'))

  const otherTenant = await api('GET', '/api/webhooks/endpoints', { token: state.tokens.ADMIN_B })
  assert.equal(otherTenant.status, 200)
  assert.deepEqual(otherTenant.data.data.map((item) => item.id), [state.endpoints.tenantB])
  const crossPatch = await api('PATCH', `/api/webhooks/endpoints/${state.endpoints.all}`, {
    token: state.tokens.ADMIN_B,
    body: { isActive: false }
  })
  assert.equal(crossPatch.status, 404)
  const crossDelete = await api('DELETE', `/api/webhooks/endpoints/${state.endpoints.all}`, { token: state.tokens.ADMIN_B })
  assert.equal(crossDelete.status, 404)

  const badEvents = await api('POST', '/api/webhooks/endpoints', {
    token: state.tokens.ADMIN_A,
    body: { url: state.receiverUrl, events: ['property.deleted'] }
  })
  assert.equal(badEvents.status, 400)
  const badUrl = await api('POST', '/api/webhooks/endpoints', {
    token: state.tokens.ADMIN_A,
    body: { url: 'file:///etc/passwd', events: ['property.created'] }
  })
  assert.equal(badUrl.status, 400)
})

test('private URLs are rejected without the explicit non-production allow flag', async () => {
  const original = process.env.WEBHOOK_ALLOW_PRIVATE_URLS
  process.env.WEBHOOK_ALLOW_PRIVATE_URLS = 'false'
  try {
    assert.equal(checkWebhookUrlConfig(state.receiverUrl).ok, false)
    assert.equal(checkWebhookUrlConfig('http://localhost:9000/hook').ok, false)
    assert.equal(checkWebhookUrlConfig('http://[::ffff:127.0.0.1]:9000/hook').ok, false)
    assert.equal(checkWebhookUrlConfig('http://user:pass@example.com/hook').ok, false)
    assert.equal(checkWebhookUrlConfig('ftp://example.com/hook').ok, false)
    await assert.rejects(validateWebhookUrl(state.receiverUrl))

    const rejected = await api('POST', '/api/webhooks/endpoints', {
      token: state.tokens.ADMIN_A,
      body: { url: state.receiverUrl, events: ['property.created'] }
    })
    assert.equal(rejected.status, 400, JSON.stringify(rejected.data))
  } finally {
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = original
  }
})

test('all four exact event codes are emitted from real API routes and signed', async () => {
  const property = await api('POST', '/api/properties', {
    token: state.tokens.ADMIN_A,
    body: {
      referenceNumber: `${tag}-HOOK-PROP`,
      title: 'Webhook property',
      type: 'APARTMENT',
      price: '150000.00',
      password: 'must-not-leak',
      accessToken: 'must-not-leak'
    }
  })
  assert.equal(property.status, 201, JSON.stringify(property.data))

  const lead = await api('POST', '/api/leads', {
    token: state.tokens.ADMIN_A,
    body: {
      firstName: 'Webhook',
      lastName: 'Created',
      assignedToId: state.users.ADMIN_A,
      propertyId: property.data.data.id,
      accessToken: 'must-not-leak'
    }
  })
  assert.equal(lead.status, 201, JSON.stringify(lead.data))

  const stage = await api('PATCH', `/api/deals/${state.dealId}`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'PENDING' }
  })
  assert.equal(stage.status, 200, JSON.stringify(stage.data))

  const payment = await api('POST', '/api/finance/payments', {
    token: state.tokens.ADMIN_A,
    body: {
      dealId: state.dealId,
      amount: '250.00',
      currency: 'USD',
      status: 'COMPLETED',
      reference: `${tag}-PAYMENT`,
      password: 'must-not-leak'
    }
  })
  assert.equal(payment.status, 201, JSON.stringify(payment.data))

  const deliveries = await waitFor(async () => {
    const result = await api('GET', '/api/webhooks/deliveries?limit=100', { token: state.tokens.ADMIN_A })
    const rows = result.data.data.filter((row) => row.endpointId === state.endpoints.all)
    return rows.length === EXPECTED_EVENTS.length ? rows : null
  }, 'all four webhook deliveries')

  assert.deepEqual(
    deliveries.map((delivery) => delivery.event).sort(),
    [...EXPECTED_EVENTS].sort()
  )
  assert.ok(deliveries.every((delivery) => delivery.status === 'SUCCESS'), JSON.stringify(deliveries))
  const serialized = JSON.stringify(deliveries.map((delivery) => delivery.payload)).toLowerCase()
  assert.ok(!serialized.includes('password'))
  assert.ok(!serialized.includes('accesstoken'))
  assert.ok(!serialized.includes('must-not-leak'))

  const receivedForTenantA = await waitFor(() => {
    const records = state.received.filter((record) => {
      try {
        return JSON.parse(record.body).organizationId === state.orgAId
      } catch {
        return false
      }
    })
    return records.length >= EXPECTED_EVENTS.length ? records : null
  }, 'signed receiver requests')
  const expectedSignatureSecretHash = hashWebhookSecret(state.secrets.all)
  for (const record of receivedForTenantA) {
    assert.ok(record.signature && record.signature.startsWith('sha256='))
    assert.equal(verifyWebhookSignature(record.body, expectedSignatureSecretHash, record.signature), true)
  }

  const otherTenantDeliveries = await api('GET', '/api/webhooks/deliveries', { token: state.tokens.ADMIN_B })
  assert.equal(otherTenantDeliveries.status, 200)
  assert.equal(otherTenantDeliveries.data.data.length, 0)
  const crossDelivery = await api('GET', `/api/webhooks/deliveries/${deliveries[0].id}`, { token: state.tokens.ADMIN_B })
  assert.equal(crossDelivery.status, 404)
})

test('a deal PATCH without a stage change emits no deal.stage_changed event', async () => {
  const before = await api('GET', `/api/webhooks/deliveries?event=deal.stage_changed&limit=100`, { token: state.tokens.ADMIN_A })
  const patch = await api('PATCH', `/api/deals/${state.dealId}`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'PENDING', notes: `${tag} same-stage update` }
  })
  assert.equal(patch.status, 200, JSON.stringify(patch.data))
  const after = await api('GET', `/api/webhooks/deliveries?event=deal.stage_changed&limit=100`, { token: state.tokens.ADMIN_A })
  assert.equal(after.data.data.length, before.data.data.length)
})

test('failed deliveries are logged without changing the core API response', async () => {
  const created = await createEndpoint(
    'failing',
    state.tokens.ADMIN_A,
    `http://127.0.0.1:${state.failedPort}/hook`,
    ['property.created']
  )
  assert.equal(created.status, 201)

  const property = await api('POST', '/api/properties', {
    token: state.tokens.ADMIN_A,
    body: {
      referenceNumber: `${tag}-FAILED-PROP`,
      title: 'Failed delivery property',
      type: 'APARTMENT',
      price: '1000.00'
    }
  })
  assert.equal(property.status, 201, JSON.stringify(property.data))
  assert.equal(property.data.success, true)

  const failed = await waitFor(async () => {
    const result = await api('GET', '/api/webhooks/deliveries?status=FAILED&limit=100', { token: state.tokens.ADMIN_A })
    return result.data.data.find((row) => row.endpointId === state.endpoints.failing) || null
  }, 'failed delivery row')
  assert.equal(failed.attempt, 1)
  assert.ok(failed.error)
  assert.ok(!JSON.stringify(failed).includes(state.secrets.failing))
})

test('retrying a delivery is admin-only and reuses the safe dispatcher', async () => {
  const failed = await waitFor(async () => {
    const result = await api('GET', '/api/webhooks/deliveries?status=FAILED&limit=100', { token: state.tokens.ADMIN_A })
    return result.data.data.find((row) => row.endpointId === state.endpoints.failing) || null
  }, 'failed delivery to retry')

  const managerRetry = await api('POST', `/api/webhooks/deliveries/${failed.id}/retry`, {
    token: state.tokens.MANAGER_A,
    body: {}
  })
  assert.equal(managerRetry.status, 403)

  const adminRetry = await api('POST', `/api/webhooks/deliveries/${failed.id}/retry`, {
    token: state.tokens.ADMIN_A,
    body: {}
  })
  assert.equal(adminRetry.status, 200, JSON.stringify(adminRetry.data))
  assert.equal(adminRetry.data.data.attempt, failed.attempt + 1)
  const after = await api('GET', `/api/webhooks/deliveries/${failed.id}`, { token: state.tokens.ADMIN_A })
  assert.equal(after.status, 200)
  assert.equal(after.data.data.attempt, failed.attempt + 1)

  const audits = await prisma.auditLog.findMany({
    where: {
      entityType: 'WebhookDelivery',
      entityId: failed.id,
      action: 'WEBHOOK_DELIVERY_RETRY'
    },
    select: { id: true }
  })
  assert.ok(audits.length >= 1)
})
