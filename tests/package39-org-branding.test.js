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
  BRANDING_DEFAULTS,
  brandingCssVariables,
  brandingDirection,
  displayBrandName,
  mergeBranding,
  safeBrandUrl
} = require('../frontend/src/utils/brandingCore.mjs')
const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG39-${runId}`
const state = { orgIds: [], userIds: [], tokens: {} }
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
    data: {
      name: `${tag} ${suffix}`,
      slug: `${tag.toLowerCase()}-${suffix}`,
      currency: 'USD',
      baseCurrency: 'USD',
      email: `support-${suffix}@example.invalid`
    },
    select: { id: true }
  })
  state.orgIds.push(org.id)
  return org.id
}

async function createUser(key, organizationId, role) {
  const password = `Branding39!${crypto.randomBytes(8).toString('base64url')}`
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
})

test.after(async () => {
  try {
    if (state.orgIds.length) {
      await prisma.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { userId: { in: state.userIds } } })
        await tx.organizationBranding.deleteMany({ where: { organizationId: { in: state.orgIds } } })
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

test('Package 39: pure branding helpers normalize colors, URLs and RTL', () => {
  assert.equal(BRANDING_DEFAULTS.primaryColor, '#2563EB')
  assert.equal(mergeBranding({ primaryColor: '#abcdef' }).primaryColor, '#abcdef')
  const variables = brandingCssVariables({ primaryColor: '#123456', theme: 'DARK' })
  assert.equal(variables['--brand-primary'], '#123456')
  assert.equal(variables['--brand-background'], '#0F172A')
  assert.equal(brandingDirection({}, 'ar'), 'rtl')
  assert.equal(brandingDirection({ brandNameAr: 'عقاري' }), 'rtl')
  assert.equal(brandingDirection({ brandNameAr: 'عقاري', brandName: 'EstateOS' }), 'ltr')
  assert.equal(displayBrandName({ brandNameAr: 'عقاري' }, 'EstateOS', 'ar'), 'عقاري')
  assert.equal(displayBrandName({}, 'EstateOS', 'en'), 'EstateOS')
  assert.equal(safeBrandUrl('/brand/logo.svg'), '/brand/logo.svg')
  assert.equal(safeBrandUrl('https://cdn.example.invalid/logo.png'), 'https://cdn.example.invalid/logo.png')
  assert.equal(safeBrandUrl('javascript:alert(1)'), null)
  assert.equal(safeBrandUrl('//evil.example.invalid/logo.png'), null)
})

test('Package 39: default branding inherits safe organization values', async () => {
  const response = await api('GET', '/api/branding', { token: state.tokens.ADMIN_A })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.equal(response.data.data.primaryColor, '#2563EB')
  assert.equal(response.data.data.theme, 'LIGHT')
  assert.ok(response.data.data.displayName.includes(tag))
  assert.equal(response.data.data.supportEmail, `support-a@example.invalid`)
  assert.equal(response.data.data.direction, 'ltr')
})

test('Package 39: managers save bilingual branding with validated colors and URLs', async () => {
  const invalidColor = await api('PATCH', '/api/branding', {
    token: state.tokens.ADMIN_A,
    body: { primaryColor: 'red; drop table' }
  })
  assert.equal(invalidColor.status, 400)

  const invalidUrl = await api('PATCH', '/api/branding', {
    token: state.tokens.ADMIN_A,
    body: { logoUrl: 'javascript:alert(1)' }
  })
  assert.equal(invalidUrl.status, 400)

  const invalidEmail = await api('PATCH', '/api/branding', {
    token: state.tokens.ADMIN_A,
    body: { supportEmail: 'not-an-email' }
  })
  assert.equal(invalidEmail.status, 400)

  const saved = await api('PATCH', '/api/branding', {
    token: state.tokens.ADMIN_A,
    body: {
      brandName: 'White Label Estate',
      brandNameAr: 'عقارات وايت لابل',
      logoUrl: 'https://cdn.example.invalid/logo.svg',
      faviconUrl: '/favicon.ico',
      primaryColor: '#abc',
      secondaryColor: '#112233',
      accentColor: '#14B8A6',
      theme: 'DARK',
      supportEmail: 'help@example.invalid',
      supportPhone: '+20 100 000 0000',
      footerText: 'Powered by EstateOS',
      footerTextAr: 'مدعوم بواسطة إستيت أو إس',
      isActive: true
    }
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))
  assert.equal(saved.data.data.primaryColor, '#AABBCC')
  assert.equal(saved.data.data.theme, 'DARK')
  assert.equal(saved.data.data.direction, 'rtl')
  assert.equal(saved.data.data.displayName, 'White Label Estate')
  assert.equal(saved.data.data.footerTextAr, 'مدعوم بواسطة إستيت أو إس')

  const row = await prisma.organizationBranding.findUnique({ where: { organizationId: state.orgIds[0] } })
  assert.ok(row)
  assert.equal(row.primaryColor, '#AABBCC')

  const audit = await prisma.auditLog.count({
    where: { action: 'BRANDING_UPDATED', entityId: row.id }
  })
  assert.equal(audit, 1)
})

test('Package 39: branding is tenant scoped and agents cannot edit it', async () => {
  const agent = await api('PATCH', '/api/branding', {
    token: state.tokens.AGENT_A,
    body: { brandName: 'Hijacked' }
  })
  assert.equal(agent.status, 403)

  const other = await api('GET', '/api/branding', { token: state.tokens.ADMIN_B })
  assert.equal(other.status, 200)
  assert.equal(other.data.data.brandName, null)
  assert.ok(other.data.data.displayName.includes('b'))

  const anonymous = await api('GET', '/api/branding')
  assert.equal(anonymous.status, 401)
})

test('Package 39: additive migration and bilingual branding UI are wired', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model OrganizationBranding/)
  assert.match(schema, /enum BrandingTheme/)
  const migration = read('prisma/migrations/20261127000000_package39_40_branding_quotas/migration.sql')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "OrganizationBranding"/)
  const router = read('frontend/src/router/index.ts')
  assert.match(router, /path: 'branding'/)
  const view = read('frontend/src/views/BrandingView.vue')
  assert.match(view, /هوية المؤسسة/)
  assert.match(view, /White-label branding/)
  assert.match(view, /:dir="previewDirection"/)
  assert.match(view, /brandingCssVariables/)
  const index = read('backend/index.ts')
  assert.match(index, /app\.use\('\/api\/branding', brandingRoutes\)/)
})
