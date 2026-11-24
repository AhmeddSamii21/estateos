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
  buildUnitGrid,
  UNIT_STATUS_META,
  unitLabel,
  unitStatus,
  unitStatusLabel
} = require('../frontend/src/utils/unitInventoryCore.mjs')
const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG42-${runId}`
const state = { orgIds: [], userIds: [], tokens: {}, propertyIds: [] }
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
  const password = `Inventory42!${crypto.randomBytes(8).toString('base64url')}`
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

async function createProperty(organizationId, suffix, data) {
  const property = await prisma.property.create({
    data: {
      organizationId,
      referenceNumber: `${tag}-${suffix}`,
      title: `${tag} ${suffix}`,
      type: 'APARTMENT',
      classification: data.status === 'RENTED' ? 'RENT' : 'SALE',
      status: data.status,
      occupancyStatus: data.occupancyStatus || null,
      price: data.price ?? 100000,
      currency: 'USD',
      area: 100,
      areaUnit: 'SQ_M',
      condition: 'GOOD',
      bedrooms: data.bedrooms ?? 2,
      bathrooms: 1,
      floors: data.floors ?? 0,
      projectName: data.projectName,
      buildingName: data.buildingName,
      unitNumber: data.unitNumber
    },
    select: { id: true, projectName: true, buildingName: true, unitNumber: true, floors: true, status: true, occupancyStatus: true, title: true, referenceNumber: true, price: true, currency: true, bedrooms: true, type: true }
  })
  state.propertyIds.push(property.id)
  return property
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

  state.properties = [
    await createProperty(orgA, 'A101', { status: 'AVAILABLE', occupancyStatus: 'VACANT', projectName: 'Tower A', buildingName: 'Block 1', unitNumber: 'A-101', floors: 1 }),
    await createProperty(orgA, 'A102', { status: 'SOLD', projectName: 'Tower A', buildingName: 'Block 1', unitNumber: 'A-102', floors: 1 }),
    await createProperty(orgA, 'B201', { status: 'RENTED', occupancyStatus: 'TENANT_OCCUPIED', projectName: 'Tower A', buildingName: 'Block 2', unitNumber: 'B-201', floors: 2, price: 2000 }),
    await createProperty(orgA, 'V1', { status: 'RESERVED', projectName: 'Villa Park', buildingName: 'Villa 1', unitNumber: 'V-1', floors: 0 }),
    await createProperty(orgA, 'V2', { status: 'UNAVAILABLE', projectName: 'Villa Park', buildingName: 'Villa 2', unitNumber: 'V-2', floors: 0 })
  ]
  await createProperty(orgB, 'OTHER', { status: 'AVAILABLE', projectName: 'Other tenant', buildingName: 'Remote', unitNumber: 'X-1', floors: 3 })
})

test.after(async () => {
  try {
    if (state.orgIds.length) {
      await prisma.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { userId: { in: state.userIds } } })
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

test('Package 42: pure unit helpers map statuses, group floors and translate labels', () => {
  assert.equal(unitStatus({ status: 'AVAILABLE', occupancyStatus: 'VACANT' }), 'AVAILABLE')
  assert.equal(unitStatus({ status: 'PENDING' }), 'RESERVED')
  assert.equal(unitStatus({ status: 'SOLD' }), 'SOLD')
  assert.equal(unitStatus({ status: 'RENTED', occupancyStatus: 'TENANT_OCCUPIED' }), 'RENTED')
  assert.equal(unitStatus({ status: 'UNAVAILABLE' }), 'MAINTENANCE')
  assert.equal(unitStatus({ status: 'OFF_MARKET' }), 'UNKNOWN')
  assert.equal(unitLabel({ unitNumber: 'A-101', referenceNumber: 'REF', id: 'id' }), 'A-101')
  assert.equal(unitLabel({ referenceNumber: 'REF', id: 'id' }), 'REF')
  assert.equal(UNIT_STATUS_META.SOLD.color, '#2563EB')
  assert.equal(unitStatusLabel('AVAILABLE', 'ar'), 'متاح')

  const grid = buildUnitGrid(state.properties, { language: 'en' })
  assert.equal(grid.total, 5)
  assert.deepEqual(grid.counts, { AVAILABLE: 1, RESERVED: 1, SOLD: 1, RENTED: 1, MAINTENANCE: 1, UNKNOWN: 0 })
  assert.deepEqual(grid.groups.map((group) => `${group.project}/${group.building}`), [
    'Tower A/Block 1',
    'Tower A/Block 2',
    'Villa Park/Villa 1',
    'Villa Park/Villa 2'
  ])
  assert.deepEqual(grid.groups[0].floors.map((floor) => floor.floor), [1])
  assert.deepEqual(grid.groups[0].floors[0].units.map((unit) => unit.label), ['A-101', 'A-102'])
  const arabic = buildUnitGrid(state.properties, { language: 'ar' })
  assert.ok(arabic.groups.some((group) => group.floors.some((floor) => floor.label === 'الأرضي')))
  assert.equal(arabic.legend.find((item) => item.key === 'SOLD').label, 'مباع')
})

test('Package 42: grid endpoint is tenant scoped, filterable and translated', async () => {
  const anonymous = await api('GET', '/api/inventory/units')
  assert.equal(anonymous.status, 401)

  const all = await api('GET', '/api/inventory/units', { token: state.tokens.ADMIN_A })
  assert.equal(all.status, 200, JSON.stringify(all.data))
  assert.equal(all.data.data.total, 5)
  assert.equal(all.data.data.groups.length, 4)
  assert.equal(all.data.data.counts.MAINTENANCE, 1)

  const project = await api('GET', `/api/inventory/units?project=${encodeURIComponent('Tower A')}`, { token: state.tokens.ADMIN_A })
  assert.equal(project.data.data.total, 3)
  const status = await api('GET', '/api/inventory/units?status=SOLD', { token: state.tokens.ADMIN_A })
  assert.equal(status.data.data.total, 1)
  assert.equal(status.data.data.groups[0].floors[0].units[0].label, 'A-102')

  const arabic = await api('GET', '/api/inventory/units?language=ar', { token: state.tokens.ADMIN_A })
  assert.ok(arabic.data.data.groups.some((group) => group.floors.some((floor) => floor.label === 'الأرضي')))

  const invalid = await api('GET', '/api/inventory/units?status=BOGUS', { token: state.tokens.ADMIN_A })
  assert.equal(invalid.status, 400)

  const otherTenant = await api('GET', '/api/inventory/units', { token: state.tokens.ADMIN_B })
  assert.equal(otherTenant.data.data.total, 1)
  assert.equal(otherTenant.data.data.groups[0].project, 'Other tenant')

  const summary = await api('GET', '/api/inventory/summary', { token: state.tokens.ADMIN_A })
  assert.equal(summary.status, 200)
  assert.equal(summary.data.data.total, 5)
  assert.equal(summary.data.data.projects, 2)
  assert.equal(summary.data.data.buildings, 4)
})

test('Package 42: unit metadata writes require management and validate input', async () => {
  const id = state.properties[0].id
  const agent = await api('PATCH', `/api/inventory/units/${id}`, {
    token: state.tokens.AGENT_A,
    body: { unitNumber: 'HACK' }
  })
  assert.equal(agent.status, 403)

  const foreign = await api('PATCH', `/api/inventory/units/${id}`, {
    token: state.tokens.ADMIN_B,
    body: { unitNumber: 'FOREIGN' }
  })
  assert.equal(foreign.status, 404)

  const tooLong = await api('PATCH', `/api/inventory/units/${id}`, {
    token: state.tokens.ADMIN_A,
    body: { unitNumber: 'X'.repeat(41) }
  })
  assert.equal(tooLong.status, 400)

  const saved = await api('PATCH', `/api/inventory/units/${id}`, {
    token: state.tokens.ADMIN_A,
    body: { projectName: 'Tower A', buildingName: 'Block 1', unitNumber: 'A-101R' }
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))
  assert.equal(saved.data.data.unitNumber, 'A-101R')

  const row = await prisma.property.findUnique({ where: { id }, select: { unitNumber: true } })
  assert.equal(row.unitNumber, 'A-101R')

  const audit = await prisma.auditLog.count({
    where: { action: 'UNIT_INVENTORY_UPDATED', entityId: id }
  })
  assert.equal(audit, 1)
})

test('Package 42: additive schema and bilingual visual grid UI are wired', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /projectName\s+String\?/)
  assert.match(schema, /buildingName\s+String\?/)
  assert.match(schema, /unitNumber\s+String\?/)
  const migration = read('prisma/migrations/20261128000000_package41_42_followups_units/migration.sql')
  assert.match(migration, /ADD COLUMN IF NOT EXISTS \"projectName\"/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS \"buildingName\"/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS \"unitNumber\"/)
  const index = read('backend/index.ts')
  assert.match(index, /app\.use\('\/api\/inventory', inventoryRoutes\)/)
  const router = read('frontend/src/router/index.ts')
  assert.match(router, /path: 'inventory'/)
  const view = read('frontend/src/views/UnitInventoryView.vue')
  assert.match(view, /شبكة مخزون الوحدات/)
  assert.match(view, /Visual unit inventory/)
  assert.match(view, /buildUnitGrid/)
  assert.match(view, /unitStatusLabel/)
})
