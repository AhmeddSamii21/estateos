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
const tag = `PKG31-${runId}`
const secrets = {
  leadNote: `INTERNAL-LEAD-NOTE-${tag}`,
  propertyNote: `OPERATIONAL-NOTE-${tag}`,
  dealNote: `INTERNAL-DEAL-NOTE-${tag}`,
  paymentNote: `INTERNAL-PAYMENT-NOTE-${tag}`,
  commissionReference: `COMMISSION-${tag}`,
  otherClient: `Other Client ${tag}`,
  otherReference: `${tag}-OTHER`
}
const state = {
  orgAId: null,
  orgBId: null,
  users: {},
  tokens: {},
  properties: {},
  leads: {},
  deals: {},
  payments: {},
  commissionId: null,
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

async function createUser(key, organizationId, role) {
  const password = `Package31!${crypto.randomBytes(10).toString('base64url')}`
  const email = `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`
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
  await createUser('AGENT_A', state.orgAId, 'AGENT')

  state.properties.a = (await prisma.property.create({
    data: {
      organizationId: state.orgAId,
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
      publicShareToken: `${tag.toLowerCase()}ashare`,
      publicShareEnabled: true,
      operationalNotes: secrets.propertyNote
    },
    select: { id: true }
  })).id
  state.properties.b = (await prisma.property.create({
    data: {
      organizationId: state.orgBId,
      referenceNumber: secrets.otherReference,
      title: `${tag} Other Tenant Villa`,
      type: 'VILLA',
      city: 'Cairo',
      price: 900,
      currency: 'EGP'
    },
    select: { id: true }
  })).id

  state.leads.a = (await prisma.lead.create({
    data: {
      firstName: 'Layla',
      lastName: 'Hassan',
      email: `lead-a-${tag.toLowerCase()}@example.invalid`,
      status: 'QUALIFIED',
      source: 'REFERRAL',
      notes: `EN: internal lead note. AR: ${secrets.leadNote}`,
      preferredCity: 'Sheikh Zayed',
      preferredType: 'APARTMENT',
      preferredBedrooms: 2,
      budgetMin: 800,
      budgetMax: 1200,
      propertyId: state.properties.a,
      assignedToId: state.users.AGENT_A.id
    },
    select: { id: true }
  })).id
  state.leads.b = (await prisma.lead.create({
    data: {
      firstName: secrets.otherClient,
      status: 'NEW',
      propertyId: state.properties.b
    },
    select: { id: true }
  })).id

  state.deals.a = (await prisma.deal.create({
    data: {
      organizationId: state.orgAId,
      propertyId: state.properties.a,
      leadId: state.leads.a,
      userId: state.users.AGENT_A.id,
      referenceNumber: `${tag}-DEAL-A`,
      type: 'SALE',
      status: 'ACTIVE',
      amount: 500000,
      currency: 'EGP',
      notes: `EN: internal deal note. AR: ${secrets.dealNote}`
    },
    select: { id: true }
  })).id
  state.deals.b = (await prisma.deal.create({
    data: {
      organizationId: state.orgBId,
      propertyId: state.properties.b,
      leadId: state.leads.b,
      userId: state.users.ADMIN_B.id,
      referenceNumber: `${tag}-DEAL-B`,
      type: 'SALE',
      status: 'ACTIVE',
      amount: 900000
    },
    select: { id: true }
  })).id

  state.payments.a = (await prisma.payment.create({
    data: {
      dealId: state.deals.a,
      amount: 1000,
      currency: 'EGP',
      status: 'COMPLETED',
      dueAt: new Date('2026-12-01T00:00:00.000Z'),
      paidAt: new Date('2026-11-20T00:00:00.000Z'),
      notes: `EN: payment note. AR: ${secrets.paymentNote}`
    },
    select: { id: true }
  })).id
  state.commissionId = (await prisma.commission.create({
    data: {
      dealId: state.deals.a,
      userId: state.users.AGENT_A.id,
      amount: 5000,
      currency: 'EGP',
      status: 'PENDING',
      notes: 'Internal commission note',
      paymentReference: secrets.commissionReference
    },
    select: { id: true }
  })).id
})

test.after(async () => {
  try {
    const orgIds = [state.orgAId, state.orgBId].filter(Boolean)
    if (orgIds.length) {
      const userIds = Object.values(state.users).map((user) => user.id)
      const leadIds = Object.values(state.leads).filter(Boolean)
      const dealIds = Object.values(state.deals).filter(Boolean)
      const propertyIds = Object.values(state.properties).filter(Boolean)
      await prisma.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })
        await tx.notification.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.commission.deleteMany({ where: { dealId: { in: dealIds } } })
        await tx.payment.deleteMany({ where: { dealId: { in: dealIds } } })
        await tx.dealClosingChecklist.deleteMany({ where: { dealId: { in: dealIds } } })
        await tx.deal.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.leadNote.deleteMany({ where: { leadId: { in: leadIds } } })
        await tx.lead.deleteMany({ where: { id: { in: leadIds } } })
        await tx.propertyDocument.deleteMany({ where: { propertyId: { in: propertyIds } } })
        await tx.propertyImage.deleteMany({ where: { propertyId: { in: propertyIds } } })
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

test('generates prefixed links and the lead portal exposes only allow-listed data', async () => {
  const leadLink = await api('POST', `/api/leads/${state.leads.a}/portal-token`, { token: state.tokens.ADMIN_A })
  assert.equal(leadLink.status, 201, JSON.stringify(leadLink.data))
  assert.equal(leadLink.data.data.enabled, true)
  assert.match(leadLink.data.data.token, /^lead_[A-Za-z0-9_-]{16,}$/)
  assert.match(leadLink.data.data.url, new RegExp(`/client-portal/${leadLink.data.data.token}$`))
  state.portal.lead = leadLink.data.data

  const dealLink = await api('POST', `/api/deals/${state.deals.a}/portal-token`, { token: state.tokens.ADMIN_A })
  assert.equal(dealLink.status, 201, JSON.stringify(dealLink.data))
  assert.match(dealLink.data.data.token, /^deal_[A-Za-z0-9_-]{16,}$/)
  state.portal.deal = dealLink.data.data

  const response = await api('GET', `/api/public/client-portal/${state.portal.lead.token}`)
  assert.equal(response.status, 200, JSON.stringify(response.data))
  const payload = response.data.data
  assert.equal(payload.kind, 'LEAD')
  assert.equal(payload.client.displayName, 'Layla Hassan')
  assert.equal(payload.client.organizationName, `${tag} a`)
  assert.equal(payload.property.referenceNumber, `${tag}-A1`)
  assert.equal(payload.lead.preferredCity, 'Sheikh Zayed')
  assert.equal(payload.deals.length, 1)
  assert.equal(payload.deals[0].referenceNumber, `${tag}-DEAL-A`)
  assert.equal(payload.deals[0].payments.length, 1)
  assert.equal(payload.deals[0].summary.paid, '1000.00')

  const keys = collectKeys(payload)
  for (const forbidden of [
    'portalToken', 'portalEnabled', 'notes', 'operationalNotes', 'publicShareToken',
    'commissions', 'commission', 'assignedAgentId', 'organizationId', 'userId',
    'leadId', 'branchId', 'teamId', 'idempotencyKey', 'paymentReference'
  ]) {
    assert.equal(keys.has(forbidden), false, `${forbidden} must not be exposed by the client portal`)
  }
  const serialized = JSON.stringify(payload)
  for (const secret of [
    secrets.leadNote, secrets.propertyNote, secrets.dealNote, secrets.paymentNote,
    secrets.commissionReference, secrets.otherClient, secrets.otherReference,
    state.portal.lead.token, state.portal.deal.token
  ]) {
    assert.equal(serialized.includes(secret), false, `secret must not appear in portal payload: ${secret}`)
  }
})

test('deal portal shows only the linked client and never exposes commissions or notes', async () => {
  const response = await api('GET', `/api/public/client-portal/${state.portal.deal.token}`)
  assert.equal(response.status, 200, JSON.stringify(response.data))
  const payload = response.data.data
  assert.equal(payload.kind, 'DEAL')
  assert.equal(payload.client.displayName, 'Layla Hassan')
  assert.equal(payload.deal.referenceNumber, `${tag}-DEAL-A`)
  assert.equal(Number(payload.deal.amount), 500000)
  assert.equal(payload.clientInterest.displayName, 'Layla Hassan')
  assert.equal(payload.deals.length, 0)
  assert.equal(payload.lead, null)

  const keys = collectKeys(payload)
  for (const forbidden of ['commissions', 'notes', 'userId', 'leadId', 'portalToken', 'paymentReference']) {
    assert.equal(keys.has(forbidden), false, `${forbidden} must not be exposed by the deal portal`)
  }
  const serialized = JSON.stringify(payload)
  for (const secret of [
    secrets.otherClient, secrets.otherReference, secrets.dealNote, secrets.paymentNote,
    secrets.commissionReference, secrets.leadNote, state.portal.lead.token
  ]) {
    assert.equal(serialized.includes(secret), false, `secret must not appear in deal portal: ${secret}`)
  }
})

test('regeneration rotates tokens and invalidates the previous capability', async () => {
  const oldLead = state.portal.lead.token
  const oldDeal = state.portal.deal.token
  const lead = await api('POST', `/api/leads/${state.leads.a}/portal-token/regenerate`, { token: state.tokens.ADMIN_A })
  const deal = await api('POST', `/api/deals/${state.deals.a}/portal-token/regenerate`, { token: state.tokens.ADMIN_A })
  assert.equal(lead.status, 200, JSON.stringify(lead.data))
  assert.equal(deal.status, 200, JSON.stringify(deal.data))
  assert.notEqual(lead.data.data.token, oldLead)
  assert.notEqual(deal.data.data.token, oldDeal)
  state.portal.lead = lead.data.data
  state.portal.deal = deal.data.data

  assert.equal((await api('GET', `/api/public/client-portal/${oldLead}`)).status, 404)
  assert.equal((await api('GET', `/api/public/client-portal/${oldDeal}`)).status, 404)
  assert.equal((await api('GET', `/api/public/client-portal/${state.portal.lead.token}`)).status, 200)
  assert.equal((await api('GET', `/api/public/client-portal/${state.portal.deal.token}`)).status, 200)
})

test('management responses never leak portal tokens or full lead notes', async () => {
  const leadList = await api('GET', `/api/leads?search=${encodeURIComponent('Layla')}`, { token: state.tokens.ADMIN_A })
  const leadDetail = await api('GET', `/api/leads/${state.leads.a}`, { token: state.tokens.ADMIN_A })
  const dealList = await api('GET', `/api/deals?search=${encodeURIComponent(tag)}`, { token: state.tokens.ADMIN_A })
  const dealDetail = await api('GET', `/api/deals/${state.deals.a}`, { token: state.tokens.ADMIN_A })
  for (const response of [leadList, leadDetail, dealList, dealDetail]) {
    assert.equal(response.status, 200, JSON.stringify(response.data))
    assert.equal(JSON.stringify(response.data).includes('portalToken'), false)
    assert.equal(JSON.stringify(response.data).includes(state.portal.lead.token), false)
    assert.equal(JSON.stringify(response.data).includes(state.portal.deal.token), false)
  }
  assert.equal('portalToken' in dealDetail.data.data, false)
  assert.equal(dealDetail.data.data.portalEnabled, true)
  assert.equal('notes' in (dealDetail.data.data.lead || {}), false)
})

test('management endpoints enforce authentication, roles, and tenant scope', async () => {
  assert.equal((await api('POST', `/api/leads/${state.leads.a}/portal-token`)).status, 401)
  assert.equal((await api('GET', `/api/deals/${state.deals.a}/portal-link`, { token: state.tokens.AGENT_A })).status, 403)

  for (const path of [
    `/api/leads/${state.leads.a}/portal-link`,
    `/api/leads/${state.leads.a}/portal-token`,
    `/api/deals/${state.deals.a}/portal-link`,
    `/api/deals/${state.deals.a}/portal-token`
  ]) {
    assert.equal((await api('GET', path, { token: state.tokens.ADMIN_B })).status, 404, `${path} must be tenant-scoped`)
  }

  const bLead = await api('POST', `/api/leads/${state.leads.b}/portal-token`, { token: state.tokens.ADMIN_B })
  assert.equal(bLead.status, 201, JSON.stringify(bLead.data))
  const bDeal = await api('POST', `/api/deals/${state.deals.b}/portal-token`, { token: state.tokens.ADMIN_B })
  assert.equal(bDeal.status, 201, JSON.stringify(bDeal.data))
  const bPortal = await api('GET', `/api/public/client-portal/${bLead.data.data.token}`)
  assert.equal(bPortal.status, 200)
  assert.equal(bPortal.data.data.client.displayName, secrets.otherClient)
  assert.equal(bPortal.data.data.deals.length, 1)
  assert.equal(bPortal.data.data.deals[0].referenceNumber, `${tag}-DEAL-B`)
  const bDealPortal = await api('GET', `/api/public/client-portal/${bDeal.data.data.token}`)
  assert.equal(bDealPortal.status, 200)
  assert.equal(bDealPortal.data.data.client.displayName, secrets.otherClient)
})

test('revocation and archive both disable access until a new link is issued', async () => {
  const revokedLead = await api('POST', `/api/leads/${state.leads.a}/portal-token/revoke`, { token: state.tokens.ADMIN_A })
  const revokedDeal = await api('DELETE', `/api/deals/${state.deals.a}/portal-token`, { token: state.tokens.ADMIN_A })
  assert.equal(revokedLead.status, 200, JSON.stringify(revokedLead.data))
  assert.equal(revokedDeal.status, 200, JSON.stringify(revokedDeal.data))
  assert.equal(revokedLead.data.data.enabled, false)
  assert.equal(revokedLead.data.data.token, null)
  assert.equal((await api('GET', `/api/public/client-portal/${state.portal.lead.token}`)).status, 404)
  assert.equal((await api('GET', `/api/public/client-portal/${state.portal.deal.token}`)).status, 404)

  const reissuedLead = await api('POST', `/api/leads/${state.leads.a}/portal-token`, { token: state.tokens.ADMIN_A })
  const reissuedDeal = await api('POST', `/api/deals/${state.deals.a}/portal-token`, { token: state.tokens.ADMIN_A })
  assert.equal(reissuedLead.status, 201)
  assert.equal(reissuedDeal.status, 201)
  assert.equal((await api('GET', `/api/public/client-portal/${reissuedLead.data.data.token}`)).status, 200)
  assert.equal((await api('GET', `/api/public/client-portal/${reissuedDeal.data.data.token}`)).status, 200)

  const archivedLead = await api('DELETE', `/api/leads/${state.leads.a}`, { token: state.tokens.ADMIN_A })
  assert.equal(archivedLead.status, 200, JSON.stringify(archivedLead.data))
  assert.equal((await api('GET', `/api/public/client-portal/${reissuedLead.data.data.token}`)).status, 404)
})

test('invalid tokens are rejected and the frontend portal routes are wired', async () => {
  assert.equal((await api('GET', '/api/public/client-portal/short')).status, 404)
  assert.equal((await api('GET', '/api/public/client-portal/%3Cscript%3E')).status, 404)
  assert.equal((await api('GET', `/api/public/client-portal/${state.portal.lead.token}`)).status, 404)

  const root = path.resolve(__dirname, '..')
  const router = fs.readFileSync(path.join(root, 'frontend/src/router/index.ts'), 'utf8')
  const view = fs.readFileSync(path.join(root, 'frontend/src/views/ClientPortalView.vue'), 'utf8')
  const panel = fs.readFileSync(path.join(root, 'frontend/src/components/ClientPortalPanel.vue'), 'utf8')
  const detail = fs.readFileSync(path.join(root, 'frontend/src/views/LeadDetail.vue'), 'utf8')
  const dealDetail = fs.readFileSync(path.join(root, 'frontend/src/views/DealDetail.vue'), 'utf8')
  const resource = fs.readFileSync(path.join(root, 'frontend/src/views/ResourceView.vue'), 'utf8')
  const publicRoute = fs.readFileSync(path.join(root, 'backend/routes/public.ts'), 'utf8')

  assert.match(router, /path: '\/client-portal\/:token'/)
  assert.match(router, /path: 'leads\/:id'/)
  assert.match(view, /\/api\/public\/client-portal\//)
  assert.match(view, /store\.isArabic/)
  assert.match(panel, /props\.entityType === 'Lead'/)
  assert.match(panel, /portal-token/)
  assert.match(panel, /\/regenerate/)
  assert.match(panel, /apiDelete<ClientPortalLink>/)
  assert.match(panel, /store\.isArabic/)
  assert.match(detail, /ClientPortalPanel/)
  assert.match(dealDetail, /ClientPortalPanel/)
  assert.match(resource, /\/leads\/\$\{row\.id\}/)
  assert.match(publicRoute, /router\.get\('\/client-portal\/:token'/)
  assert.match(publicRoute, /clientPortalKind/)
})
