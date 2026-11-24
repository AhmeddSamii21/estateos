const test = require('node:test')
const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.RATE_LIMIT_MAX_REQUESTS = '10000'
process.env.PUBLIC_RATE_LIMIT_MAX = '10000'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')
const { leadScope, ownerReadScope } = require('../dist-backend/utils/scope.js')

let baseUrl
let server

// Real users already in the database: no seeding and no destructive cleanup.
// Tokens are signed exactly like the API does (id + tokenVersion claims).
const principals = { ADMIN: null, AGENT: null }
const idsByRole = { ADMIN: {}, AGENT: {} }
const skipNotes = { ADMIN: [], AGENT: [] }

const DUMMY_SHARE_TOKEN = 'SmokeTestShareToken000001'

// Prisma validates select/include relation names before matching any row, so a
// syntactically valid surrogate id still exercises a detail query. Real ids are
// always preferred; surrogates are only used when the database has no rows.
const SURROGATE_IDS = {
  property: '00000000-0000-4000-8000-000000000001',
  propertyImage: '00000000-0000-4000-8000-000000000002',
  owner: '00000000-0000-4000-8000-000000000003',
  lead: '00000000-0000-4000-8000-000000000004',
  deal: '00000000-0000-4000-8000-000000000005',
  appointment: '00000000-0000-4000-8000-000000000006',
  maintenance: '00000000-0000-4000-8000-000000000007',
  document: '00000000-0000-4000-8000-000000000008',
  user: '00000000-0000-4000-8000-000000000009',
  publicImage: '00000000-0000-4000-8000-000000000010'
}

function tokenFor(user) {
  return jwt.sign(
    { id: user.id, tokenVersion: user.tokenVersion },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  )
}

function withId(path, id) {
  return `${path}/${encodeURIComponent(id)}`
}

async function findPrincipal(role) {
  const user = await prisma.user.findFirst({
    where: {
      role,
      isActive: true,
      deletedAt: null,
      accountStatus: 'ACTIVE',
      organization: { isActive: true, deletedAt: null }
    },
    select: {
      id: true,
      email: true,
      role: true,
      tokenVersion: true,
      organizationId: true
    },
    orderBy: { createdAt: 'asc' }
  })
  if (!user) throw new Error(`Package 11 smoke audit needs an active ${role} user in the database`)
  return { ...user, token: tokenFor(user) }
}

async function pickId(model, localWhere, globalWhere, key, notes) {
  const local = await prisma[model].findFirst({ where: localWhere, select: { id: true } })
  if (local) return local.id
  const global = await prisma[model].findFirst({ where: globalWhere, select: { id: true } })
  if (global) {
    notes.push(`${key}: no local row, using a real cross-organization id (expect 404)`)
    return global.id
  }
  notes.push(`${key}: no row exists, using a synthetic id to exercise the query`)
  return SURROGATE_IDS[key]
}

async function loadRealIds(principal, notes) {
  const org = principal.organizationId

  const propertyId = await pickId(
    'property',
    { organizationId: org, deletedAt: null },
    { deletedAt: null },
    'property',
    notes
  )
  const ownerId = await pickId(
    'owner',
    { ...ownerReadScope(org), deletedAt: null },
    { deletedAt: null },
    'owner',
    notes
  )
  const leadId = await pickId(
    'lead',
    { deletedAt: null, ...leadScope(org) },
    { deletedAt: null },
    'lead',
    notes
  )
  const dealId = await pickId(
    'deal',
    { organizationId: org, deletedAt: null },
    { deletedAt: null },
    'deal',
    notes
  )
  const appointmentId = await pickId(
    'appointment',
    { user: { organizationId: org } },
    {},
    'appointment',
    notes
  )
  const maintenanceId = await pickId(
    'maintenanceRequest',
    { organizationId: org, deletedAt: null },
    { deletedAt: null },
    'maintenance',
    notes
  )
  const documentId = await pickId(
    'document',
    { organizationId: org, deletedAt: null },
    { deletedAt: null },
    'document',
    notes
  )
  const userId = await pickId(
    'user',
    { organizationId: org, deletedAt: null },
    { deletedAt: null },
    'user',
    notes
  )
  const propertyImageId = await pickId(
    'propertyImage',
    { propertyId, deletedAt: null },
    { deletedAt: null },
    'propertyImage',
    notes
  )

  const publicProperty = await prisma.property.findFirst({
    where: { publicShareEnabled: true, publicShareToken: { not: null }, isActive: true, deletedAt: null },
    select: { id: true, publicShareToken: true }
  })
  if (!publicProperty) {
    notes.push('publicShareToken: no shared property exists, using a syntactically valid synthetic token (expect 404)')
  }
  const publicImage = publicProperty
    ? await prisma.propertyImage.findFirst({
        where: { propertyId: publicProperty.id, deletedAt: null },
        select: { id: true }
      })
    : null
  if (publicProperty && !publicImage) {
    notes.push('publicImage: shared property has no image, using a synthetic image id (expect 404)')
  }

  return {
    propertyId,
    propertyImageId,
    ownerId,
    leadId,
    dealId,
    appointmentId,
    maintenanceId,
    documentId,
    userId,
    shareToken: publicProperty?.publicShareToken || DUMMY_SHARE_TOKEN,
    publicImageId: publicImage?.id || SURROGATE_IDS.publicImage
  }
}

function buildEndpoints(role, ids) {
  const endpoints = []
  const add = (name, path, options = {}) => endpoints.push({ name, path, ...options })

  // Health / auth
  add('health', '/api/health')
  add('auth.me', '/api/auth/me')

  // Properties
  add('properties.list', '/api/properties')
  add('properties.search', '/api/properties/search?q=smoke')
  add('properties.board', '/api/properties/board')
  add('properties.detail', withId('/api/properties', ids.propertyId))
  add('properties.duplicateDraft', withId('/api/properties', ids.propertyId) + '/duplicate-draft')
  add('properties.shareLink', withId('/api/properties', ids.propertyId) + '/share-link')
  add('properties.images', withId('/api/properties', ids.propertyId) + '/images')
  add('properties.imageContent', withId('/api/properties', ids.propertyId) + `/images/${ids.propertyImageId}/content`, { binary: true })

  // Leads
  add('leads.list', '/api/leads')
  add('leads.detail', withId('/api/leads', ids.leadId))
  add('leads.matches', withId('/api/leads', ids.leadId) + '/matches')

  // Deals
  add('deals.list', '/api/deals')
  add('deals.leaseRenewals', '/api/deals/lease-renewals')
  add('deals.detail', withId('/api/deals', ids.dealId))

  // Appointments
  add('appointments.list', '/api/appointments')
  add('appointments.detail', withId('/api/appointments', ids.appointmentId))

  // Finance
  add('finance.commissionStatements', '/api/finance/commission-statements')
  add('finance.exchangeRates', '/api/finance/exchange-rates')
  add('finance.payments', '/api/finance/payments')
  add(
    'finance.paymentsSummary',
    `/api/finance/payments/summary?dealId=${encodeURIComponent(ids.dealId || 'no-deal-id')}`
  )
  add('finance.expenses', '/api/finance/expenses')
  add('finance.commissions', '/api/finance/commissions')

  // Maintenance
  add('maintenance.list', '/api/maintenance')
  add('maintenance.detail', withId('/api/maintenance', ids.maintenanceId))

  // Owners
  add('owners.list', '/api/owners')
  add('owners.detail', withId('/api/owners', ids.ownerId))
  add('owners.statement', withId('/api/owners', ids.ownerId) + '/statement')

  // Documents
  add('documents.list', '/api/documents')
  add('documents.download', withId('/api/documents', ids.documentId) + '/download', { binary: true })

  // Reports (uncontacted-leads is a CSV export, not JSON)
  add('reports.summary', '/api/reports/summary')
  add('reports.financial', '/api/reports/financial')
  add('reports.properties', '/api/reports/properties')
  add('reports.team', '/api/reports/team')
  add('reports.uncontactedLeads', '/api/reports/uncontacted-leads', { binary: true })

  // Activity
  add('activity.list', '/api/activity')
  add('activity.entity', withId('/api/activity/Property', ids.propertyId))

  // Notifications
  add('notifications.list', '/api/notifications')
  add('notifications.unreadCount', '/api/notifications/unread-count')

  // Settings
  add('settings.get', '/api/settings')
  add('settings.exchangeRates', '/api/settings/exchange-rates')

  // Users
  add('users.me', '/api/users/me')
  add('users.list', '/api/users')
  add('users.detail', withId('/api/users', ids.userId))

  // Admin + global search
  add('admin.exportSnapshot', '/api/admin/export-snapshot')
  add('search.global', '/api/search?q=smoke')

  // Public routes are unauthenticated and may legitimately return 404/429.
  const tokenPath = encodeURIComponent(ids.shareToken)
  add('public.property', `/api/public/properties/${tokenPath}`, { public: true })
  add(
    'public.imageContent',
    `/api/public/properties/${tokenPath}/images/${encodeURIComponent(ids.publicImageId)}/content`,
    { public: true, binary: true }
  )

  return endpoints
}

const ERROR_MARKERS = [
  /PrismaClientValidationError/i,
  /PrismaClientKnownRequestError/i,
  /Unknown field/i,
  /Invalid[^\r\n]{0,120}\b(select|include)\b/i,
  /Internal server error/i,
  /Cannot read properties of (undefined|null)/i,
  /is not a function/i
]

function allowedStatuses(endpoint) {
  if (endpoint.public) return [200, 400, 404, 429]
  return [200, 400, 403, 404]
}

async function probe(endpoint, token) {
  const headers = token && !endpoint.public ? { Authorization: `Bearer ${token}` } : {}
  const response = await fetch(`${baseUrl}${endpoint.path}`, {
    headers,
    signal: AbortSignal.timeout(20000)
  })
  const text = await response.text()
  const findings = []

  if (response.status >= 500) findings.push(`HTTP ${response.status}`)
  if (!allowedStatuses(endpoint).includes(response.status)) {
    findings.push(`unexpected HTTP ${response.status}`)
  }

  const snippet = text.length > 200000 ? text.slice(0, 200000) : text
  for (const marker of ERROR_MARKERS) {
    if (marker.test(snippet)) findings.push(`body matched ${marker}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!endpoint.binary && (contentType.includes('application/json') || snippet.trimStart().startsWith('{'))) {
    let body
    try {
      body = JSON.parse(text)
    } catch {
      findings.push('response was not valid JSON')
    }
    if (body && typeof body === 'object') {
      const message = String(body.error?.message ?? body.message ?? '')
      if (body.success === false && /500|internal|prisma|unknown field|invalid.*(select|include)/i.test(message)) {
        findings.push(`success:false with server-style message "${message}"`)
      }
    }
  }

  return findings
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  principals.ADMIN = await findPrincipal('ADMIN')
  principals.AGENT = await findPrincipal('AGENT')
  idsByRole.ADMIN = await loadRealIds(principals.ADMIN, skipNotes.ADMIN)
  idsByRole.AGENT = await loadRealIds(principals.AGENT, skipNotes.AGENT)
})

test.after(async () => {
  await shutdown()
})

for (const role of ['ADMIN', 'AGENT']) {
  test(`${role}: every GET endpoint is free of 5xx and Prisma query errors`, async (t) => {
    const principal = principals[role]
    const notes = skipNotes[role]
    const endpoints = buildEndpoints(role, idsByRole[role])

    for (const note of notes) t.diagnostic(`ID NOTE ${role} ${note}`)
    assert.ok(endpoints.length >= 45, `${role}: expected the full GET endpoint catalogue`)

    const failures = []
    for (const endpoint of endpoints) {
      try {
        const findings = await probe(endpoint, principal.token)
        if (findings.length) {
          failures.push(`${endpoint.name} ${endpoint.path} -> ${findings.join('; ')}`)
        }
      } catch (error) {
        failures.push(`${endpoint.name} ${endpoint.path} -> request failed: ${error.message}`)
      }
    }

    assert.equal(
      failures.length,
      0,
      `${role} GET smoke failures (${failures.length}/${endpoints.length}):\n${failures.join('\n')}`
    )
  })
}
