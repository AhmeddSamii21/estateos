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

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG35-${runId}`
const state = { orgIds: [], userIds: [], tokens: {}, partnerId: null, propertyId: null, leadId: null, dealId: null, splitId: null }
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
  const password = `Referral35!${crypto.randomBytes(8).toString('base64url')}`
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

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const orgA = await createOrg('a')
  await createUser('ADMIN_A', orgA, 'ADMIN')
  await createUser('AGENT_A', orgA, 'AGENT')
  const orgB = await createOrg('b')
  await createUser('ADMIN_B', orgB, 'ADMIN')

  const property = await prisma.property.create({
    data: {
      organizationId: orgA,
      referenceNumber: `${tag}-PROPERTY`,
      title: `${tag} Apartment`,
      type: 'APARTMENT',
      classification: 'SALE',
      status: 'AVAILABLE',
      price: 100000,
      currency: 'USD',
      area: 100,
      areaUnit: 'SQ_M',
      condition: 'EXCELLENT',
      bedrooms: 2,
      bathrooms: 2
    },
    select: { id: true }
  })
  state.propertyId = property.id
  const lead = await prisma.lead.create({
    data: { propertyId: property.id, firstName: `${tag} Client`, assignedToId: state.userIds[1] },
    select: { id: true }
  })
  state.leadId = lead.id
  const deal = await prisma.deal.create({
    data: {
      organizationId: orgA,
      propertyId: property.id,
      leadId: lead.id,
      userId: state.userIds[1],
      status: 'ACTIVE',
      amount: 100000,
      currency: 'USD',
      referenceNumber: `${tag}-DEAL`
    },
    select: { id: true }
  })
  state.dealId = deal.id
})

test.after(async () => {
  try {
    if (state.orgIds.length) {
      await prisma.$transaction(async (tx) => {
        await tx.referralSplit.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.referralPartner.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.auditLog.deleteMany({ where: { userId: { in: state.userIds } } })
        await tx.deal.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.lead.deleteMany({ where: { assignedTo: { organizationId: { in: state.orgIds } } } })
        await tx.property.deleteMany({ where: { organizationId: { in: state.orgIds } } })
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

test('Package 35: management creates partners and validates commission rates', async () => {
  const invalid = await api('POST', '/api/referrals/partners', {
    token: state.tokens.ADMIN_A,
    body: { name: `${tag} Invalid`, commissionRate: 120 }
  })
  assert.equal(invalid.status, 400)

  const created = await api('POST', '/api/referrals/partners', {
    token: state.tokens.ADMIN_A,
    body: {
      name: `${tag} Broker`,
      nameAr: `${tag} وسيط`,
      commissionRate: 12.5,
      email: 'broker@example.invalid',
      isActive: true
    }
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  assert.equal(created.data.data.commissionRate, '12.50')
  state.partnerId = created.data.data.id

  const forbidden = await api('POST', '/api/referrals/partners', {
    token: state.tokens.AGENT_A,
    body: { name: `${tag} Agent partner` }
  })
  assert.equal(forbidden.status, 403)

  const updated = await api('PATCH', `/api/referrals/partners/${state.partnerId}`, {
    token: state.tokens.ADMIN_A,
    body: { commissionRate: 15 }
  })
  assert.equal(updated.status, 200)
  assert.equal(updated.data.data.commissionRate, '15.00')
})

test('Package 35: splits snapshot the rate and compute the amount from the deal', async () => {
  const created = await api('POST', '/api/referrals/splits', {
    token: state.tokens.ADMIN_A,
    body: { partnerId: state.partnerId, dealId: state.dealId, rate: 12.5, notes: `${tag} split` }
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  assert.equal(created.data.data.rate, '12.50')
  assert.equal(created.data.data.amount, '12500.00')
  assert.equal(created.data.data.currency, 'USD')
  assert.equal(created.data.data.status, 'PENDING')
  state.splitId = created.data.data.id

  const duplicate = await api('POST', '/api/referrals/splits', {
    token: state.tokens.ADMIN_A,
    body: { partnerId: state.partnerId, dealId: state.dealId }
  })
  assert.equal(duplicate.status, 409)

  const list = await api('GET', '/api/referrals/splits', { token: state.tokens.ADMIN_A })
  assert.equal(list.status, 200)
  assert.equal(list.data.data.some((row) => row.id === state.splitId), true)

  const summary = await api('GET', '/api/referrals/summary', { token: state.tokens.ADMIN_A })
  assert.equal(summary.status, 200)
  assert.equal(summary.data.data.splitCount, 1)
  assert.equal(summary.data.data.byPartner[0].total, '12500.00')
})

test('Package 35: split status transitions are guarded and audited', async () => {
  const approved = await api('PATCH', `/api/referrals/splits/${state.splitId}/status`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'APPROVED' }
  })
  assert.equal(approved.status, 200, JSON.stringify(approved.data))
  assert.equal(approved.data.data.status, 'APPROVED')
  assert.ok(approved.data.data.approvedAt)

  const paid = await api('PATCH', `/api/referrals/splits/${state.splitId}/status`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'PAID' }
  })
  assert.equal(paid.status, 200)
  assert.equal(paid.data.data.status, 'PAID')
  assert.ok(paid.data.data.paidAt)

  const invalid = await api('PATCH', `/api/referrals/splits/${state.splitId}/status`, {
    token: state.tokens.ADMIN_A,
    body: { status: 'PENDING' }
  })
  assert.equal(invalid.status, 400)

  const audit = await prisma.auditLog.count({
    where: { action: 'REFERRAL_SPLIT_STATUS_CHANGED', entityId: state.splitId }
  })
  assert.equal(audit, 2)
})

test('Package 35: tenant isolation and agent scoping hold for referral data', async () => {
  const crossPartner = await api('PATCH', `/api/referrals/partners/${state.partnerId}`, {
    token: state.tokens.ADMIN_B,
    body: { name: 'Stolen' }
  })
  assert.equal(crossPartner.status, 404)

  const crossSplit = await api('PATCH', `/api/referrals/splits/${state.splitId}/status`, {
    token: state.tokens.ADMIN_B,
    body: { status: 'CANCELLED' }
  })
  assert.equal(crossSplit.status, 404)

  const otherOrg = await createOrg('c-agent')
  await createUser('AGENT_C', otherOrg, 'AGENT')
  const forbiddenSplit = await api('POST', '/api/referrals/splits', {
    token: state.tokens.AGENT_C,
    body: { partnerId: state.partnerId, dealId: state.dealId }
  })
  assert.equal(forbiddenSplit.status, 404)

  const agentList = await api('GET', '/api/referrals/splits', { token: state.tokens.AGENT_A })
  assert.equal(agentList.status, 200)
  assert.equal(agentList.data.data.length, 1)
  assert.equal(agentList.data.data[0].dealId, state.dealId)
})

test('Package 35: additive migration and bilingual referral UI are wired', () => {
  const migration = read('prisma/migrations/20261126000000_package35_36_referrals_contracts/migration.sql')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "ReferralPartner"/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "ReferralSplit"/)
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model ReferralPartner/)
  assert.match(schema, /model ReferralSplit/)
  const router = read('frontend/src/router/index.ts')
  assert.match(router, /path: 'referrals'/)
  const view = read('frontend/src/views/ReferralsView.vue')
  assert.match(view, /:dir="store\.direction"/)
  assert.match(view, /شركاء الإحالة/)
  assert.match(view, /Referral partners/)
  assert.match(view, /referrals\/splits/)
  const index = read('backend/index.ts')
  assert.match(index, /app\.use\('\/api\/referrals', referralRoutes\)/)
})
