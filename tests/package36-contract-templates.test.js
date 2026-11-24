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
  CONTRACT_TOKENS,
  buildContractPreview,
  contractValueContext,
  missingContractTokens,
  renderContractText,
  selectContractBody
} = require('../frontend/src/utils/contractTemplateCore.mjs')
const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG36-${runId}`
const state = { orgIds: [], userIds: [], tokens: {}, templateId: null, propertyId: null, leadId: null, dealId: null }
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
  const password = `Contract36!${crypto.randomBytes(8).toString('base64url')}`
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
      title: `${tag} Villa`,
      type: 'VILLA',
      classification: 'SALE',
      status: 'AVAILABLE',
      price: 500000,
      currency: 'USD',
      area: 320,
      areaUnit: 'SQ_M',
      condition: 'EXCELLENT',
      bedrooms: 4,
      bathrooms: 3,
      city: 'Cairo'
    },
    select: { id: true }
  })
  state.propertyId = property.id
  const lead = await prisma.lead.create({
    data: {
      propertyId: property.id,
      firstName: 'Amira',
      lastName: 'Hassan',
      assignedToId: state.userIds[1]
    },
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
      amount: 500000,
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
        await tx.auditLog.deleteMany({ where: { userId: { in: state.userIds } } })
        await tx.contractTemplate.deleteMany({ where: { organizationId: { in: state.orgIds } } })
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

test('Package 36: pure helpers render bilingual placeholders without executing input', () => {
  assert.ok(CONTRACT_TOKENS.includes('client_name'))
  assert.equal(
    renderContractText('Dear {{ client_name }}, missing {{ value }}', { client_name: 'Amira' }),
    'Dear Amira, missing {{value}}'
  )
  assert.equal(renderContractText('{{ client_name }}', {}), '—')
  assert.deepEqual(missingContractTokens('{{ value }} {{ other }} {{ client_name }}'), ['other', 'value'])
  assert.equal(selectContractBody({ body: 'English', bodyAr: 'عربي' }, 'ar'), 'عربي')
  assert.equal(selectContractBody({ body: 'English', bodyAr: null }, 'ar'), 'English')

  const template = { name: 'Sale', nameAr: 'بيع', body: 'Buyer: {{ client_name }}', bodyAr: 'المشتري: {{ client_name }}' }
  const arabic = buildContractPreview(template, { client_name: 'Amira' }, 'ar')
  assert.equal(arabic.title, 'بيع')
  assert.equal(arabic.body, 'المشتري: Amira')
  assert.equal(arabic.direction, 'rtl')
  assert.deepEqual(arabic.missingTokens, [])

  const context = contractValueContext({
    deal: { referenceNumber: 'REF-1', amount: 100, currency: 'USD' },
    property: { title: 'Villa', city: 'Cairo', area: 320 },
    lead: { firstName: 'Amira', lastName: 'Hassan' },
    user: { firstName: 'Omar' },
    organization: { name: 'EstateOS' },
    today: '2026-11-24'
  })
  assert.equal(context.client_name, 'Amira Hassan')
  assert.equal(context.deal_amount, '100')
  assert.equal(context.today, '2026-11-24')
})

test('Package 36: management creates versioned bilingual templates and agents cannot', async () => {
  const created = await api('POST', '/api/contracts/templates', {
    token: state.tokens.ADMIN_A,
    body: {
      name: `${tag} Sale Contract`,
      nameAr: `${tag} عقد بيع`,
      language: 'BILINGUAL',
      body: 'This contract is between {{ organization_name }} and {{ client_name }} for {{ property_title }} ({{ deal_reference }}). Amount: {{ deal_amount }} {{ deal_currency }}. Unknown: {{ bogus }}',
      bodyAr: 'هذا العقد بين {{ organization_name }} و{{ client_name }} على {{ property_title }} بمبلغ {{ deal_amount }} {{ deal_currency }}.'
    }
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  assert.equal(created.data.data.version, 1)
  state.templateId = created.data.data.id

  const forbidden = await api('POST', '/api/contracts/templates', {
    token: state.tokens.AGENT_A,
    body: { name: `${tag} Agent template`, body: 'x' }
  })
  assert.equal(forbidden.status, 403)

  const updated = await api('PATCH', `/api/contracts/templates/${state.templateId}`, {
    token: state.tokens.ADMIN_A,
    body: { bodyAr: 'المشتري: {{ client_name }} · العقار: {{ property_title }} · المبلغ: {{ deal_amount }} {{ deal_currency }}.' }
  })
  assert.equal(updated.status, 200)
  assert.equal(updated.data.data.version, 2)
})

test('Package 36: deal-backed preview resolves tokens and reports unknown placeholders', async () => {
  const english = await api('POST', `/api/contracts/templates/${state.templateId}/render`, {
    token: state.tokens.AGENT_A,
    body: { dealId: state.dealId, language: 'en' }
  })
  assert.equal(english.status, 200, JSON.stringify(english.data))
  assert.equal(english.data.data.direction, 'ltr')
  assert.match(english.data.data.body, /Amira Hassan/)
  assert.match(english.data.data.body, /Villa/)
  assert.match(english.data.data.body, /500000\.00 USD/)
  assert.deepEqual(english.data.data.missingTokens, ['bogus'])

  const arabic = await api('POST', `/api/contracts/templates/${state.templateId}/render`, {
    token: state.tokens.ADMIN_A,
    body: { dealId: state.dealId, language: 'ar' }
  })
  assert.equal(arabic.status, 200)
  assert.equal(arabic.data.data.direction, 'rtl')
  assert.equal(arabic.data.data.hasArabicBody, true)
  assert.match(arabic.data.data.body, /المشتري|هذا العقد/)
})

test('Package 36: templates and previews stay tenant and deal scoped', async () => {
  const crossTenant = await api('POST', `/api/contracts/templates/${state.templateId}/render`, {
    token: state.tokens.ADMIN_B,
    body: { dealId: state.dealId }
  })
  assert.equal(crossTenant.status, 404)

  const otherOrg = await createOrg('c-agent')
  await createUser('AGENT_C', otherOrg, 'AGENT')
  const crossDeal = await api('POST', `/api/contracts/templates/${state.templateId}/render`, {
    token: state.tokens.AGENT_C,
    body: { dealId: state.dealId }
  })
  assert.equal(crossDeal.status, 404)

  const listB = await api('GET', '/api/contracts/templates', { token: state.tokens.ADMIN_B })
  assert.equal(listB.status, 200)
  assert.equal(listB.data.data.length, 0)

  const listA = await api('GET', '/api/contracts/templates', { token: state.tokens.ADMIN_A })
  assert.equal(listA.data.data.length, 1)
})

test('Package 36: additive migration and bilingual contract UI are wired', () => {
  const migration = read('prisma/migrations/20261126000000_package35_36_referrals_contracts/migration.sql')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "ContractTemplate"/)
  assert.match(migration, /ContractTemplateLanguage/)
  const router = read('frontend/src/router/index.ts')
  assert.match(router, /path: 'contracts'/)
  const view = read('frontend/src/views/ContractTemplatesView.vue')
  assert.match(view, /قوالب العقود/)
  assert.match(view, /Contract templates/)
  assert.match(view, /:dir="preview\.direction"/)
  assert.match(view, /CONTRACT_TOKENS/)
  assert.match(view, /templates\/\$\{selectedId\.value\}\/render/)
  const index = read('backend/index.ts')
  assert.match(index, /app\.use\('\/api\/contracts', contractRoutes\)/)
})
