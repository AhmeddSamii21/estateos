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
  MAP_STATUS_META,
  buildAvailabilityMap,
  mapStatus,
  mapStatusLabel,
  masterplanDataUrl
} = require('../frontend/src/utils/liveMapCore.mjs')
const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG44-${runId}`
const state = { orgIds: [], userIds: [], propertyIds: [], tokens: {}, users: {}, properties: {} }
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
  const password = `Maps44!${crypto.randomBytes(8).toString('base64url')}`
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
  state.users[key] = user
  const login = await api('POST', '/api/auth/login', { body: { email, password } })
  assert.equal(login.status, 200, `${key} login failed: ${JSON.stringify(login.data)}`)
  state.tokens[key] = login.data.data.token
  return user.id
}

async function createProperty(key, organizationId, data) {
  const property = await prisma.property.create({
    data: {
      organizationId,
      referenceNumber: `${tag}-${key}`,
      title: `${tag} ${key}`,
      type: data.type || 'APARTMENT',
      classification: 'SALE',
      status: data.status,
      occupancyStatus: data.occupancyStatus || null,
      price: data.price,
      currency: 'EGP',
      area: 120,
      areaUnit: 'SQ_M',
      condition: 'EXCELLENT',
      bedrooms: 3,
      bathrooms: 2,
      floors: data.floors ?? 3,
      projectName: data.projectName,
      buildingName: data.buildingName,
      unitNumber: data.unitNumber,
      city: data.city || 'Cairo',
      cityArea: data.cityArea,
      latitude: data.latitude,
      longitude: data.longitude,
      unitLatitude: data.unitLatitude,
      unitLongitude: data.unitLongitude,
      mapX: data.mapX,
      mapY: data.mapY,
      masterplanImageUrl: data.masterplanImageUrl,
      assignedAgentId: data.assignedAgentId || null,
      branchId: data.branchId || null,
      teamId: data.teamId || null
    },
    select: { id: true }
  })
  state.propertyIds.push(property.id)
  state.properties[key] = property
  return property.id
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const orgA = await createOrg('a')
  const orgB = await createOrg('b')
  await createUser('ADMIN_A', orgA, 'ADMIN')
  await createUser('TEAM_LEAD_A', orgA, 'TEAM_LEAD')
  await createUser('AGENT_A', orgA, 'AGENT')
  await createUser('AGENT_OTHER', orgA, 'AGENT')
  await createUser('ADMIN_B', orgB, 'ADMIN')

  const branch = await prisma.branch.create({
    data: { organizationId: orgA, name: `${tag} Branch`, code: `B${runId}` },
    select: { id: true }
  })
  state.branchId = branch.id
  const team = await prisma.team.create({
    data: { organizationId: orgA, name: `${tag} Team`, branchId: branch.id, leaderId: state.users.TEAM_LEAD_A.id },
    select: { id: true }
  })
  state.teamId = team.id

  for (const key of ['TEAM_LEAD_A', 'AGENT_A']) {
    await prisma.user.update({
      where: { id: state.users[key].id },
      data: { branchId: branch.id, teamId: team.id }
    })
  }

  await createProperty('TOWER_AVAILABLE', orgA, {
    status: 'AVAILABLE', projectName: 'Package44 Tower', buildingName: 'Block A', unitNumber: 'T-A-101',
    price: 100000, assignedAgentId: state.users.AGENT_A.id, branchId: branch.id, teamId: team.id,
    cityArea: 'Fifth Settlement', latitude: 30.0259, longitude: 31.4912,
    unitLatitude: 30.0262, unitLongitude: 31.4915, mapX: 38, mapY: 44,
    masterplanImageUrl: '/demo/masterplans/cairo-gardens.svg'
  })
  await createProperty('TOWER_SOLD', orgA, {
    status: 'SOLD', projectName: 'Package44 Tower', buildingName: 'Block A', unitNumber: 'T-A-102',
    price: 200000, floors: 4, assignedAgentId: state.users.TEAM_LEAD_A.id, branchId: branch.id, teamId: team.id,
    cityArea: 'Fifth Settlement', latitude: 30.0259, longitude: 31.4912
  })
  await createProperty('VILLA_RESERVED', orgA, {
    status: 'RESERVED', projectName: 'Package44 Villa', buildingName: 'Villa 4', unitNumber: 'V-4',
    type: 'VILLA', price: 300000, floors: 0, assignedAgentId: state.users.AGENT_OTHER.id,
    cityArea: 'Sheikh Zayed', latitude: 30.0197, longitude: 31.0089, mapX: 60, mapY: 30
  })
  await createProperty('FOREIGN', orgB, {
    status: 'AVAILABLE', projectName: 'Package44 Foreign', buildingName: 'Remote', unitNumber: 'F-1',
    price: 999999, assignedAgentId: state.users.ADMIN_B.id, latitude: 24.7136, longitude: 46.6753
  })
})

test.after(async () => {
  try {
    if (state.orgIds.length) {
      await prisma.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { userId: { in: state.userIds } } })
        await tx.property.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.team.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.branch.deleteMany({ where: { organizationId: { in: state.orgIds } } })
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

test('Package 44: pure map helpers bucket statuses, filter and translate', () => {
  assert.equal(mapStatus({ status: 'AVAILABLE', occupancyStatus: 'VACANT' }), 'AVAILABLE')
  assert.equal(mapStatus({ status: 'UNDER_NEGOTIATION' }), 'RESERVED')
  assert.equal(mapStatus({ status: 'RENTED', occupancyStatus: 'TENANT_OCCUPIED' }), 'RESERVED')
  assert.equal(mapStatus({ status: 'SOLD' }), 'SOLD')
  assert.equal(MAP_STATUS_META.AVAILABLE.color, '#10B981')
  assert.equal(mapStatusLabel('AVAILABLE', 'ar'), 'متاح')

  const units = [
    { id: 'u1', status: 'AVAILABLE', price: 100, currency: 'EGP', projectName: 'Tower', buildingName: 'A', unitNumber: 'U-1', type: 'APARTMENT', latitude: 30, longitude: 31, unitLatitude: 30.001, unitLongitude: 31.001, mapX: 20, mapY: 30 },
    { id: 'u2', status: 'SOLD', price: 300, currency: 'EGP', projectName: 'Tower', buildingName: 'A', unitNumber: 'U-2', type: 'VILLA', latitude: 30, longitude: 31 },
    { id: 'u3', status: 'PENDING', price: 200, currency: 'EGP', projectName: 'Villa', buildingName: 'B', unitNumber: 'U-3', type: 'APARTMENT', latitude: 31, longitude: 32 }
  ]
  const map = buildAvailabilityMap(units, { language: 'en' })
  assert.deepEqual(map.counts, { AVAILABLE: 1, RESERVED: 1, SOLD: 1 })
  assert.equal(map.totals.projects, 2)
  assert.equal(map.projects.find((project) => project.name === 'Tower').minPrice, 100)
  assert.equal(map.projects.find((project) => project.name === 'Tower').maxPrice, 300)
  assert.ok(map.units.find((unit) => unit.id === 'u1').hasGeoPin)
  assert.ok(map.units.find((unit) => unit.id === 'u1').hasMasterplanPin)
  assert.ok(!map.units.find((unit) => unit.id === 'u3').hasMasterplanPin)

  const filtered = buildAvailabilityMap(units, { filters: { project: 'Tower', status: 'SOLD', minPrice: 50, maxPrice: 500 } })
  assert.equal(filtered.totals.units, 1)
  assert.equal(filtered.units[0].id, 'u2')
  const arabic = buildAvailabilityMap(units, { language: 'ar' })
  assert.equal(arabic.legend.find((item) => item.key === 'SOLD').label, 'مباع')
  assert.match(masterplanDataUrl('Tower', 'ar'), /^data:image\/svg/)
})

test('Package 44: availability endpoint aggregates live counts and is tenant scoped', async () => {
  const anonymous = await api('GET', '/api/maps/availability')
  assert.equal(anonymous.status, 401)

  const all = await api('GET', '/api/maps/availability', { token: state.tokens.ADMIN_A })
  assert.equal(all.status, 200, JSON.stringify(all.data))
  assert.deepEqual(all.data.data.counts, { AVAILABLE: 1, RESERVED: 1, SOLD: 1 })
  assert.equal(all.data.data.totals.units, 3)
  assert.equal(all.data.data.totals.projects, 2)
  const tower = all.data.data.projects.find((project) => project.name === 'Package44 Tower')
  assert.deepEqual(tower.counts, { AVAILABLE: 1, RESERVED: 0, SOLD: 1 })
  assert.equal(tower.minPrice, 100000)
  assert.equal(tower.maxPrice, 200000)
  assert.equal(tower.masterplanImageUrl, '/demo/masterplans/cairo-gardens.svg')
  assert.ok(all.data.data.units.find((unit) => unit.unitNumber === 'T-A-101').hasMasterplanPin)

  const foreign = await api('GET', '/api/maps/availability', { token: state.tokens.ADMIN_B })
  assert.equal(foreign.data.data.totals.units, 1)
  assert.equal(foreign.data.data.units[0].project, 'Package44 Foreign')

  const project = await api('GET', `/api/maps/availability?project=${encodeURIComponent('Package44 Tower')}`, { token: state.tokens.ADMIN_A })
  assert.equal(project.data.data.totals.units, 2)
  const status = await api('GET', '/api/maps/availability?status=SOLD', { token: state.tokens.ADMIN_A })
  assert.equal(status.data.data.totals.units, 1)
  assert.equal(status.data.data.units[0].unitNumber, 'T-A-102')
  const type = await api('GET', '/api/maps/availability?type=VILLA', { token: state.tokens.ADMIN_A })
  assert.equal(type.data.data.totals.units, 1)
  const price = await api('GET', '/api/maps/availability?minPrice=150000&maxPrice=250000', { token: state.tokens.ADMIN_A })
  assert.equal(price.data.data.totals.units, 1)
  assert.equal(price.data.data.units[0].unitNumber, 'T-A-102')

  const arabic = await api('GET', '/api/maps/availability?language=ar', { token: state.tokens.ADMIN_A })
  assert.equal(arabic.data.data.legend.find((item) => item.key === 'AVAILABLE').label, 'متاح')
  const invalid = await api('GET', '/api/maps/availability?status=BOGUS', { token: state.tokens.ADMIN_A })
  assert.equal(invalid.status, 400)
})

test('Package 44: map visibility follows AGENT and TEAM_LEAD scope server-side', async () => {
  const agent = await api('GET', '/api/maps/availability', { token: state.tokens.AGENT_A })
  assert.equal(agent.status, 200)
  assert.equal(agent.data.data.totals.units, 1)
  assert.equal(agent.data.data.units[0].unitNumber, 'T-A-101')

  const lead = await api('GET', '/api/maps/availability', { token: state.tokens.TEAM_LEAD_A })
  assert.equal(lead.status, 200)
  assert.equal(lead.data.data.totals.units, 2)
  assert.deepEqual(lead.data.data.units.map((unit) => unit.unitNumber).sort(), ['T-A-101', 'T-A-102'])
  assert.ok(!lead.data.data.units.some((unit) => unit.unitNumber === 'V-4'))
})

test('Package 44: coordinate updates are audited, scoped and validated', async () => {
  const id = state.properties.TOWER_AVAILABLE.id
  const agentWrite = await api('PATCH', `/api/properties/${id}/coordinates`, {
    token: state.tokens.AGENT_A, body: { mapX: 10 }
  })
  assert.equal(agentWrite.status, 403)

  const foreignWrite = await api('PATCH', `/api/properties/${id}/coordinates`, {
    token: state.tokens.ADMIN_B, body: { mapX: 10 }
  })
  assert.equal(foreignWrite.status, 404)

  const invalid = await api('PATCH', `/api/properties/${id}/coordinates`, {
    token: state.tokens.ADMIN_A, body: { mapX: 150 }
  })
  assert.equal(invalid.status, 400)

  const saved = await api('PATCH', `/api/properties/${id}/coordinates`, {
    token: state.tokens.ADMIN_A,
    body: { mapX: 42.5, mapY: 17.25, unitLatitude: 30.0265, unitLongitude: 31.4918, cityArea: 'Fifth Settlement' }
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))
  assert.equal(Number(saved.data.data.mapX), 42.5)

  const row = await prisma.property.findUnique({
    where: { id },
    select: { mapX: true, mapY: true, unitLatitude: true, unitLongitude: true, cityArea: true }
  })
  assert.equal(Number(row.mapX), 42.5)
  assert.equal(Number(row.mapY), 17.25)
  assert.equal(Number(row.unitLatitude), 30.0265)
  assert.equal(row.cityArea, 'Fifth Settlement')

  const audit = await prisma.auditLog.count({
    where: { action: 'PROPERTY_COORDINATES_UPDATED', entityId: id }
  })
  assert.equal(audit, 1)

  const leadOwn = await api('PATCH', `/api/properties/${state.properties.TOWER_SOLD.id}/coordinates`, {
    token: state.tokens.TEAM_LEAD_A, body: { mapY: 55 }
  })
  assert.equal(leadOwn.status, 200)
  const leadHidden = await api('PATCH', `/api/properties/${state.properties.VILLA_RESERVED.id}/coordinates`, {
    token: state.tokens.TEAM_LEAD_A, body: { mapY: 55 }
  })
  assert.equal(leadHidden.status, 403)
})

test('Package 44: additive schema, routes, bilingual UI and offline demo are wired', () => {
  const schema = read('prisma/schema.prisma')
  for (const field of ['cityArea', 'masterplanImageUrl', 'mapX', 'mapY', 'unitLatitude', 'unitLongitude']) {
    assert.match(schema, new RegExp(`${field}\\s+(String|Decimal)\\?`))
  }
  const migration = read('prisma/migrations/20261129000000_package44_live_availability_maps/migration.sql')
  for (const field of ['cityArea', 'masterplanImageUrl', 'mapX', 'mapY', 'unitLatitude', 'unitLongitude']) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS "${field}"`))
  }
  assert.doesNotMatch(migration, /DROP|TRUNCATE/i)

  assert.match(read('backend/index.ts'), /app\.use\('\/api\/maps', mapRoutes\)/)
  assert.match(read('frontend/src/router/index.ts'), /path: 'maps'/)
  assert.match(read('frontend/src/components/Layout.vue'), /Availability map/)

  const view = read('frontend/src/views/LiveAvailabilityMapView.vue')
  assert.match(view, /خريطة التوفر المباشر/)
  assert.match(view, /Live availability map/)
  assert.match(view, /Stacking grid|شبكة التكديس/)
  assert.match(view, /Installment simulator|محاكاة الأقساط/)
  assert.match(view, /Add to comparison|أضف للمقارنة/)
  assert.match(view, /leaflet/)
  assert.match(view, /L\.circleMarker/)
  assert.match(view, /masterplanDataUrl/)
  assert.match(view, /@media print/)

  const demoAdapter = read('frontend/src/api/demoAdapter.ts')
  assert.match(demoAdapter, /root === 'maps'/)
  assert.match(demoAdapter, /third === 'coordinates'/)
  const demoData = read('frontend/src/api/demoData.ts')
  assert.match(demoData, /mapSeeds/)
  assert.match(demoData, /North Coast Marina Village/)
  assert.match(demoData, /Fifth Settlement/)
  assert.match(demoData, /Sheikh Zayed/)

  for (const file of ['skyline-residence.svg', 'november-business-hub.svg', 'october-family-villas.svg', 'cairo-gardens.svg', 'north-coast-marina.svg']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'demo', 'masterplans', file)), `${file} must exist for the offline demo`)
  }
})
