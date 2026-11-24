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
  COMPARE_MAX,
  COMPARE_MIN,
  validateCompareSelection,
  pricePerSqm,
  buildCompareRows,
  buildCompareSummary,
  buildCompareWhatsAppMessage
} = require('../frontend/src/utils/propertyCompareCore.mjs')
const { buildWhatsAppUrl } = require('../frontend/src/utils/whatsappCore.mjs')
const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG34-${runId}`
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
  const password = `Compare34!${crypto.randomBytes(8).toString('base64url')}`
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

async function createProperty(index, token, extra = {}) {
  const response = await api('POST', '/api/properties', {
    token,
    body: {
      referenceNumber: `${tag}-P${index}`,
      title: `${tag} Property ${index}`,
      type: 'APARTMENT',
      classification: 'SALE',
      city: index % 2 ? 'Giza' : 'Cairo',
      price: 100000 * (index + 1),
      currency: 'EGP',
      area: 100 * (index + 1),
      bedrooms: index + 1,
      bathrooms: 2,
      features: `EN: balcony ${index} / AR: شرفة ${index}`,
      paymentTerms: `EN: ${index * 10}% down / AR: ${index * 10}% مقدّم`,
      ...extra
    }
  })
  assert.equal(response.status, 201, JSON.stringify(response.data))
  state.propertyIds.push(response.data.data.id)
  return response.data.data.id
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

  await createProperty(1, state.tokens.ADMIN_A)
  await createProperty(2, state.tokens.ADMIN_A, { assignedAgentId: state.userIds[1] })
  await createProperty(3, state.tokens.ADMIN_A)
  await createProperty(4, state.tokens.ADMIN_B)
})

test.after(async () => {
  try {
    if (state.orgIds.length) {
      await prisma.$transaction(async (tx) => {
        await tx.propertyImage.deleteMany({ where: { propertyId: { in: state.propertyIds } } })
        await tx.property.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.auditLog.deleteMany({ where: { userId: { in: state.userIds } } })
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

test('Package 34: comparison selection enforces 2-4 unique properties', () => {
  assert.equal(COMPARE_MIN, 2)
  assert.equal(COMPARE_MAX, 4)
  assert.deepEqual(validateCompareSelection(['a', 'b', 'a']), ['a', 'b'])
  assert.throws(() => validateCompareSelection(['a']), /between 2 and 4/i)
  assert.throws(() => validateCompareSelection(['a', 'b', 'c', 'd', 'e']), /between 2 and 4/i)
  assert.throws(() => validateCompareSelection(null), /between 2 and 4/i)
})

test('Package 34: pure comparison rows cover price/sqm, location, terms, photos and features', () => {
  const properties = [
    { title: 'Flat A', referenceNumber: 'A', price: '200000', currency: 'EGP', area: 100, bedrooms: 2, bathrooms: 1, city: 'Cairo', paymentTerms: '10% down', features: 'Balcony', images: [{ url: '/photo-a.jpg', isPrimary: true }] },
    { title: 'Flat B', referenceNumber: 'B', price: '300000', currency: 'EGP', area: 120, bedrooms: 3, bathrooms: 2, city: 'Giza', paymentTerms: '20% down', features: 'Garden' }
  ]
  assert.equal(pricePerSqm(properties[0]), 2000)
  assert.equal(pricePerSqm({ price: 100, area: 0 }), null)
  const rows = buildCompareRows(properties, 'en')
  assert.deepEqual(rows.map((row) => row.key), [
    'price', 'pricePerSqm', 'area', 'rooms', 'location', 'paymentTerms', 'coverPhoto', 'features'
  ])
  assert.deepEqual(rows.find((row) => row.key === 'price').values, ['200,000.00 EGP', '300,000.00 EGP'])
  assert.match(rows.find((row) => row.key === 'pricePerSqm').values[0], /2,000\.00 EGP/)
  assert.equal(rows.find((row) => row.key === 'rooms').values[1], '3 / 2')
  assert.equal(rows.find((row) => row.key === 'coverPhoto').values[0], '/photo-a.jpg')
  assert.match(rows.find((row) => row.key === 'paymentTerms').values[0], /10% down/)

  const arabic = buildCompareRows(properties, 'ar')
  assert.equal(arabic.find((row) => row.key === 'price').label, 'السعر')
  assert.equal(arabic.find((row) => row.key === 'paymentTerms').label, 'شروط الدفع')
  assert.match(buildCompareSummary(properties, 'ar'), /مقارنة العقارات/)
  assert.match(buildCompareSummary(properties, 'en'), /EstateOS property comparison/)
})

test('Package 34: comparison summary is printable and shareable via WhatsApp', () => {
  const properties = [
    { title: 'Flat A', price: 100, currency: 'USD', area: 50, city: 'Cairo' },
    { title: 'Flat B', price: 200, currency: 'USD', area: 80, city: 'Giza' }
  ]
  const message = buildCompareWhatsAppMessage(properties, 'en')
  assert.match(message, /EstateOS property comparison/)
  assert.match(message, /Price \/ sqm/)
  const url = buildWhatsAppUrl('01000000000', message)
  assert.match(url, /^https:\/\/wa\.me\/201000000000\?text=/)
  assert.equal(new URL(url).searchParams.get('text'), message)
})

test('Package 34: API compare endpoint is tenant-scoped and agent-scoped', async () => {
  const ids = state.propertyIds.slice(0, 3).join(',')
  const response = await api('GET', `/api/properties/compare?ids=${ids}`, { token: state.tokens.ADMIN_A })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.equal(response.data.data.properties.length, 3)
  assert.match(response.data.data.properties[0].features, /شرفة/)
  assert.match(response.data.data.properties[1].paymentTerms, /مقدّم/)

  const invalid = await api('GET', `/api/properties/compare?ids=${state.propertyIds[0]}`, { token: state.tokens.ADMIN_A })
  assert.equal(invalid.status, 400)

  const crossTenant = await api('GET', `/api/properties/compare?ids=${state.propertyIds[0]},${state.propertyIds[3]}`, { token: state.tokens.ADMIN_A })
  assert.equal(crossTenant.status, 404)

  const agent = await api('GET', `/api/properties/compare?ids=${state.propertyIds[0]},${state.propertyIds[1]}`, { token: state.tokens.AGENT_A })
  assert.equal(agent.status, 404)
  const agentOwned = await api('GET', `/api/properties/compare?ids=${state.propertyIds[1]},${state.propertyIds[2]}`, { token: state.tokens.AGENT_A })
  assert.equal(agentOwned.status, 404)
})

test('Package 34: bilingual compare UI, form fields and additive migration are wired', () => {
  const list = read('frontend/src/views/PropertyList.vue')
  assert.match(list, /buildCompareRows/)
  assert.match(list, /compare-sheet/)
  assert.match(list, /onPrintCompare/)
  assert.match(list, /buildWhatsAppUrl/)
  assert.match(list, /:dir="store\.direction"/)
  assert.match(list, /store\.isArabic \? 'مقارنة' : 'Compare'/)
  const form = read('frontend/src/views/PropertyForm.vue')
  assert.match(form, /v-model="form\.features"/)
  assert.match(form, /v-model="form\.paymentTerms"/)
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /features\s+String\?/)
  assert.match(schema, /paymentTerms\s+String\?/)
  const migration = read('prisma/migrations/20261125000000_package34_compare_fields/migration.sql')
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "features"/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "paymentTerms"/)
  const printCss = read('frontend/src/assets/styles/print.css')
  assert.match(printCss, /@media print/)
})
