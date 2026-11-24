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

const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG29-${runId}`
const state = {
  orgIds: [],
  users: {},
  tokens: {},
  passwords: {}
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
  state.orgIds.push(org.id)
  return org.id
}

async function createUser(key, organizationId, role) {
  const password = `Profile29!${crypto.randomBytes(8).toString('base64url')}`
  const email = `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`
  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 4),
      role,
      organizationId,
      firstName: `${tag} ${key}`,
      isActive: true
    },
    select: { id: true, email: true }
  })
  state.users[key] = user
  state.passwords[key] = password
  const login = await api('POST', '/api/auth/login', { body: { email, password } })
  assert.equal(login.status, 200, `${key} login failed: ${JSON.stringify(login.data)}`)
  state.tokens[key] = login.data.data.token
  return user
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const orgId = await createOrg('main')
  await createUser('AGENT', orgId, 'AGENT')
  await createUser('PASSWORD_USER', orgId, 'AGENT')
})

test.after(async () => {
  try {
    if (state.orgIds.length) {
      const userIds = Object.values(state.users).map((user) => user.id)
      await prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({ where: { userId: { in: userIds } } })
        await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })
        await tx.user.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.organization.deleteMany({ where: { id: { in: state.orgIds } } })
      })
    }
  } finally {
    await shutdown()
  }
})

test('GET /auth/me returns profile fields without auth secrets', async () => {
  const response = await api('GET', '/api/auth/me', { token: state.tokens.AGENT })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  const data = response.data.data
  assert.equal(data.id, state.users.AGENT.id)
  assert.equal(data.email, state.users.AGENT.email)
  assert.equal(data.role, 'AGENT')
  assert.equal(data.isActive, true)
  assert.equal(data.preferredLang, 'en')
  assert.equal(data.defaultLanguage, 'en')
  assert.equal(data.avatarUrl, null)
  assert.equal(data.phone, null)
  assert.equal(data.jobTitle, null)
  assert.equal(data.monthlyTargetAmount, null)
  assert.ok(data.lastLoginAt)
  assert.ok(!Object.keys(data).includes('password'))
  assert.ok(!Object.keys(data).includes('tokenVersion'))
})

test('PATCH /auth/me updates only self-service profile fields', async () => {
  const avatarUrl = 'https://cdn.example.test/avatars/agent.png'
  const response = await api('PATCH', '/api/auth/me', {
    token: state.tokens.AGENT,
    body: {
      firstName: 'Bilingual Agent',
      phone: '+20 100 444 5566',
      jobTitle: 'Sales Agent',
      avatarUrl,
      preferredLang: 'ar'
    }
  })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.equal(response.data.data.firstName, 'Bilingual Agent')
  assert.equal(response.data.data.phone, '+20 100 444 5566')
  assert.equal(response.data.data.jobTitle, 'Sales Agent')
  assert.equal(response.data.data.avatarUrl, avatarUrl)
  assert.equal(response.data.data.preferredLang, 'ar')

  const stored = await prisma.user.findUnique({
    where: { id: state.users.AGENT.id },
    select: { firstName: true, phone: true, jobTitle: true, avatarUrl: true, preferredLang: true }
  })
  assert.deepEqual(stored, {
    firstName: 'Bilingual Agent',
    phone: '+20 100 444 5566',
    jobTitle: 'Sales Agent',
    avatarUrl,
    preferredLang: 'ar'
  })

  const refreshed = await api('GET', '/api/auth/me', { token: state.tokens.AGENT })
  assert.equal(refreshed.status, 200)
  assert.equal(refreshed.data.data.preferredLang, 'ar')
})

test('PATCH /auth/me rejects unsafe values and ignores privileged fields', async () => {
  const badAvatar = await api('PATCH', '/api/auth/me', {
    token: state.tokens.AGENT,
    body: { avatarUrl: 'javascript:alert(1)' }
  })
  assert.equal(badAvatar.status, 400)

  const badLanguage = await api('PATCH', '/api/auth/me', {
    token: state.tokens.AGENT,
    body: { preferredLang: 'fr' }
  })
  assert.equal(badLanguage.status, 400)

  const escalation = await api('PATCH', '/api/auth/me', {
    token: state.tokens.AGENT,
    body: {
      firstName: 'Still Agent',
      role: 'ADMIN',
      isActive: false,
      accountStatus: 'SUSPENDED',
      email: `hacked-${tag.toLowerCase()}@example.invalid`
    }
  })
  assert.equal(escalation.status, 200, JSON.stringify(escalation.data))

  const stored = await prisma.user.findUnique({
    where: { id: state.users.AGENT.id },
    select: { role: true, isActive: true, accountStatus: true, email: true, firstName: true }
  })
  assert.equal(stored.role, 'AGENT')
  assert.equal(stored.isActive, true)
  assert.equal(stored.accountStatus, 'ACTIVE')
  assert.equal(stored.email, state.users.AGENT.email)
  assert.equal(stored.firstName, 'Still Agent')
})

test('change-password validates input and revokes existing sessions', async () => {
  const userId = state.users.PASSWORD_USER.id
  const oldPassword = state.passwords.PASSWORD_USER
  const newPassword = `Changed29!${crypto.randomBytes(6).toString('hex')}`
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true, password: true } })

  const wrongCurrent = await api('POST', '/api/auth/change-password', {
    token: state.tokens.PASSWORD_USER,
    body: { currentPassword: 'WrongPassword123!', newPassword }
  })
  assert.equal(wrongCurrent.status, 401)

  const weakPassword = await api('POST', '/api/auth/change-password', {
    token: state.tokens.PASSWORD_USER,
    body: { currentPassword: oldPassword, newPassword: 'weakpass' }
  })
  assert.equal(weakPassword.status, 400)

  const mismatch = await api('POST', '/api/auth/change-password', {
    token: state.tokens.PASSWORD_USER,
    body: { currentPassword: oldPassword, newPassword, confirmPassword: `${newPassword}x` }
  })
  assert.equal(mismatch.status, 400)

  const changed = await api('POST', '/api/auth/change-password', {
    token: state.tokens.PASSWORD_USER,
    body: { currentPassword: oldPassword, newPassword, confirmPassword: newPassword }
  })
  assert.equal(changed.status, 200, JSON.stringify(changed.data))
  assert.match(changed.data.message, /sign in again/i)

  const revoked = await api('GET', '/api/auth/me', { token: state.tokens.PASSWORD_USER })
  assert.equal(revoked.status, 401)
  assert.match(revoked.data.error.message, /revoked/i)

  const oldLogin = await api('POST', '/api/auth/login', {
    body: { email: state.users.PASSWORD_USER.email, password: oldPassword }
  })
  assert.equal(oldLogin.status, 401)

  const newLogin = await api('POST', '/api/auth/login', {
    body: { email: state.users.PASSWORD_USER.email, password: newPassword }
  })
  assert.equal(newLogin.status, 200, JSON.stringify(newLogin.data))
  state.tokens.PASSWORD_USER = newLogin.data.data.token
  state.passwords.PASSWORD_USER = newPassword

  const after = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true, password: true } })
  assert.equal(after.tokenVersion, before.tokenVersion + 1)
  assert.notEqual(after.password, before.password)

  const audit = await prisma.auditLog.findFirst({
    where: { userId, action: 'USER_PASSWORD_CHANGED' },
    select: { id: true }
  })
  assert.ok(audit)
})

test('frontend profile screen is wired bilingually into the account menu', () => {
  const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
  const profile = read('frontend/src/views/ProfileView.vue')
  const layout = read('frontend/src/components/Layout.vue')
  const router = read('frontend/src/router/index.ts')
  const store = read('frontend/src/stores/index.ts')
  const types = read('frontend/src/types/index.ts')

  assert.match(profile, /apiGet<AuthUser>\('\/auth\/me'\)/)
  assert.match(profile, /store\.changePassword/)
  assert.match(profile, /store\.isArabic/)
  assert.match(profile, /ملفي الشخصي/)
  assert.match(profile, /preferredLang/)
  assert.match(layout, /to="\/profile"/)
  assert.match(layout, /userMenuOpen/)
  assert.match(router, /path: 'profile'/)
  assert.match(store, /apiPatch<AuthUser>\('\/auth\/me'/)
  assert.match(store, /apiPost\('\/auth\/change-password'/)
  assert.match(types, /avatarUrl\?: string \| null/)
})
