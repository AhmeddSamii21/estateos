const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const bcrypt = require('bcrypt')

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'

const {
  PLAN_LIMITS,
  planName,
  quotaPercent,
  quotaRows,
  quotaStatus,
  upgradeHint
} = require('../frontend/src/utils/planQuotaCore.mjs')
const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG40-${runId}`
const state = {
  orgIds: [],
  userIds: [],
  tokens: {},
  propertyId: null,
  createdUserIds: [],
  createdPropertyIds: [],
  createdDealIds: []
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
  const isJson = (response.headers.get('content-type') || '').includes('application/json')
  return { status: response.status, data: text && isJson ? JSON.parse(text) : null, text }
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
  const password = `Quota40!${crypto.randomBytes(8).toString('base64url')}`
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
      title: `${tag} Flat`,
      type: 'APARTMENT',
      classification: 'SALE',
      status: 'AVAILABLE',
      price: 100000,
      currency: 'USD',
      area: 100,
      areaUnit: 'SQ_M',
      condition: 'GOOD',
      bedrooms: 2,
      bathrooms: 1
    },
    select: { id: true }
  })
  state.propertyId = property.id
})

test.after(async () => {
  try {
    if (state.orgIds.length) {
      await prisma.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { userId: { in: [...state.userIds, ...state.createdUserIds] } } })
        await tx.deal.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.property.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.user.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.planQuota.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.organization.deleteMany({ where: { id: { in: state.orgIds } } })
      })
    }
  } finally {
    await shutdown()
    if (server?.listening) await new Promise((resolve) => server.close(resolve))
  }
})

test('Package 40: pure plan math marks unlimited, warning and blocked resources', () => {
  assert.equal(PLAN_LIMITS.FREE.users, 50)
  assert.equal(PLAN_LIMITS.ENTERPRISE.properties, null)
  assert.equal(quotaStatus(5, 10), 'OK')
  assert.equal(quotaStatus(8, 10), 'WARNING')
  assert.equal(quotaStatus(10, 10), 'LIMIT_REACHED')
  assert.equal(quotaStatus(3, null), 'UNLIMITED')
  assert.equal(quotaPercent(8, 10), 80)
  assert.equal(quotaPercent(1, 0), null)
  assert.equal(upgradeHint('LIMIT_REACHED'), 'UPGRADE_REQUIRED')
  assert.equal(planName('GROWTH', 'ar'), 'نمو')

  const rows = quotaRows(
    { users: 8, properties: 20, deals: 0, storageMb: 2 },
    { users: 10, properties: 100, deals: null, storageMb: 100 },
    'ar'
  )
  assert.deepEqual(rows.map((row) => row.key), ['users', 'properties', 'deals', 'storageMb'])
  assert.equal(rows[0].status, 'WARNING')
  assert.equal(rows[0].label, 'أعضاء الفريق')
  assert.equal(rows[2].status, 'UNLIMITED')
  assert.equal(rows[2].remaining, null)
})

test('Package 40: FREE quotas report real tenant usage by default', async () => {
  const response = await api('GET', '/api/quotas', { token: state.tokens.ADMIN_A })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.equal(response.data.data.plan, 'FREE')
  assert.deepEqual(response.data.data.limits, PLAN_LIMITS.FREE)
  assert.equal(response.data.data.usage.users, 2)
  assert.equal(response.data.data.usage.properties, 1)
  assert.equal(response.data.data.usage.deals, 0)
  assert.equal(response.data.data.entries.length, 4)
  assert.equal(response.data.data.entries[0].status, 'OK')

  const arabic = await api('GET', '/api/quotas?language=ar', { token: state.tokens.ADMIN_A })
  assert.equal(arabic.data.data.entries[0].label, 'أعضاء الفريق')

  const anonymous = await api('GET', '/api/quotas')
  assert.equal(anonymous.status, 401)
})

test('Package 40: only administrators can change plans and caps', async () => {
  const agent = await api('PATCH', '/api/quotas', {
    token: state.tokens.AGENT_A,
    body: { plan: 'ENTERPRISE' }
  })
  assert.equal(agent.status, 403)

  const invalidPlan = await api('PATCH', '/api/quotas', {
    token: state.tokens.ADMIN_A,
    body: { plan: 'PLATINUM' }
  })
  assert.equal(invalidPlan.status, 400)

  const updated = await api('PATCH', '/api/quotas', {
    token: state.tokens.ADMIN_A,
    body: { plan: 'STARTER', overrides: { users: 2, properties: 1, deals: 0, storageMb: 5 } }
  })
  assert.equal(updated.status, 200, JSON.stringify(updated.data))
  assert.equal(updated.data.data.plan, 'STARTER')
  assert.deepEqual(updated.data.data.limits, { users: 2, properties: 1, deals: 0, storageMb: 5 })
  assert.equal(updated.data.data.entries.find((entry) => entry.key === 'deals').status, 'LIMIT_REACHED')

  const audit = await prisma.auditLog.count({ where: { action: 'PLAN_QUOTA_UPDATED' } })
  assert.equal(audit, 1)
})

test('Package 40: hard caps block user, property and deal creation', async () => {
  const user = await api('POST', '/api/users', {
    token: state.tokens.ADMIN_A,
    body: { email: `${tag.toLowerCase()}-blocked@example.invalid`, password: 'Quota40!blocked', role: 'AGENT' }
  })
  assert.equal(user.status, 409)

  const property = await api('POST', '/api/properties', {
    token: state.tokens.ADMIN_A,
    body: { title: `${tag} Blocked`, type: 'APARTMENT', price: '1000' }
  })
  assert.equal(property.status, 409)

  const deal = await api('POST', '/api/deals', {
    token: state.tokens.ADMIN_A,
    body: { propertyId: state.propertyId, amount: '1000', currency: 'USD' }
  })
  assert.equal(deal.status, 409)
})

test('Package 40: raising or removing caps restores writes and stays tenant scoped', async () => {
  const raised = await api('PATCH', '/api/quotas', {
    token: state.tokens.ADMIN_A,
    body: { plan: 'GROWTH', overrides: { users: 10, properties: 10, deals: 10, storageMb: null } }
  })
  assert.equal(raised.status, 200)
  assert.equal(raised.data.data.limits.storageMb, null)
  assert.equal(raised.data.data.entries.find((entry) => entry.key === 'storageMb').status, 'UNLIMITED')

  const email = `${tag.toLowerCase()}-allowed@example.invalid`
  const user = await api('POST', '/api/users', {
    token: state.tokens.ADMIN_A,
    body: { email, password: 'Quota40!allowed', role: 'AGENT' }
  })
  assert.equal(user.status, 201, JSON.stringify(user.data))
  if (user.data?.data?.id) state.createdUserIds.push(user.data.data.id)

  const property = await api('POST', '/api/properties', {
    token: state.tokens.ADMIN_A,
    body: { title: `${tag} Allowed`, type: 'APARTMENT', price: '1000' }
  })
  assert.equal(property.status, 201, JSON.stringify(property.data))
  if (property.data?.data?.id) state.createdPropertyIds.push(property.data.data.id)

  const deal = await api('POST', '/api/deals', {
    token: state.tokens.ADMIN_A,
    body: { propertyId: state.propertyId, amount: '1000', currency: 'USD' }
  })
  assert.equal(deal.status, 201, JSON.stringify(deal.data))
  if (deal.data?.data?.id) state.createdDealIds.push(deal.data.data.id)

  const other = await api('GET', '/api/quotas', { token: state.tokens.ADMIN_B })
  assert.equal(other.data.data.plan, 'FREE')
  assert.equal(other.data.data.usage.users, 1)
})

test('Package 40: additive migration and bilingual quota UI are wired', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model PlanQuota/)
  assert.match(schema, /enum PlanTier/)
  const migration = read('prisma/migrations/20261127000000_package39_40_branding_quotas/migration.sql')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "PlanQuota"/)
  const router = read('frontend/src/router/index.ts')
  assert.match(router, /path: 'quotas'/)
  const view = read('frontend/src/views/QuotasView.vue')
  assert.match(view, /خطة المؤسسة والحدود/)
  assert.match(view, /Plan & usage quotas/)
  assert.match(view, /quotaRows/)
  const index = read('backend/index.ts')
  assert.match(index, /app\.use\('\/api\/quotas', quotaRoutes\)/)
})
