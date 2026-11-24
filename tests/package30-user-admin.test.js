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
const tag = `PKG30-${runId}`
const state = {
  orgIds: [],
  users: {},
  tokens: {},
  passwords: {},
  branchId: null,
  teamId: null,
  propertyId: null,
  leadId: null,
  dealId: null
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

async function apiWithConflictRetry(method, requestPath, options = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await api(method, requestPath, options)
    if (response.status !== 409) return response
  }
  return api(method, requestPath, options)
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
  const password = `Admin30!${crypto.randomBytes(8).toString('base64url')}`
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

  const orgA = await createOrg('a')
  await createUser('ADMIN_A', orgA, 'ADMIN')
  await createUser('MANAGER_A', orgA, 'MANAGER')
  await createUser('TEAM_LEAD_A', orgA, 'TEAM_LEAD')
  await createUser('AGENT_A', orgA, 'AGENT')

  const orgB = await createOrg('b')
  await createUser('ADMIN_B', orgB, 'ADMIN')

  const orgC = await createOrg('c')
  await createUser('ADMIN_C1', orgC, 'ADMIN')
  await createUser('ADMIN_C2', orgC, 'ADMIN')

  state.branchId = (await prisma.branch.create({
    data: { organizationId: orgA, name: `${tag} Branch`, code: 'BR30' },
    select: { id: true }
  })).id
  state.teamId = (await prisma.team.create({
    data: {
      organizationId: orgA,
      branchId: state.branchId,
      name: `${tag} Team`,
      leaderId: state.users.TEAM_LEAD_A.id
    },
    select: { id: true }
  })).id

  state.propertyId = (await prisma.property.create({
    data: {
      organizationId: orgA,
      referenceNumber: `${tag}-PROP`,
      title: `${tag} Apartment`,
      type: 'APARTMENT',
      status: 'AVAILABLE',
      classification: 'SALE',
      city: 'Cairo',
      price: 100000,
      currency: 'USD'
    },
    select: { id: true }
  })).id

  await prisma.lead.create({
    data: {
      propertyId: state.propertyId,
      assignedToId: state.users.AGENT_A.id,
      firstName: 'Active',
      lastName: 'Lead',
      email: `${tag.toLowerCase()}-lead@example.invalid`,
      status: 'NEW',
      source: 'TEST'
    },
    select: { id: true }
  })

  state.dealId = (await prisma.deal.create({
    data: {
      organizationId: orgA,
      propertyId: state.propertyId,
      userId: state.users.AGENT_A.id,
      referenceNumber: `${tag}-DEAL`,
      type: 'SALE',
      status: 'ACTIVE',
      amount: 250000
    },
    select: { id: true }
  })).id
})

test.after(async () => {
  try {
    if (state.orgIds.length) {
      const userIds = Object.values(state.users).map((user) => user.id)
      await prisma.$transaction(async (tx) => {
        await tx.team.updateMany({
          where: { organizationId: { in: state.orgIds } },
          data: { leaderId: null }
        })
        await tx.user.updateMany({
          where: { organizationId: { in: state.orgIds } },
          data: { branchId: null, teamId: null }
        })
        await tx.notification.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { organizationId: { in: state.orgIds } }] } })
        await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })
        await tx.payment.deleteMany({ where: { deal: { organizationId: { in: state.orgIds } } } })
        await tx.dealClosingChecklist.deleteMany({ where: { deal: { organizationId: { in: state.orgIds } } } })
        await tx.deal.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.leadNote.deleteMany({ where: { authorId: { in: userIds } } })
        await tx.lead.deleteMany({
          where: {
            OR: [
              { property: { organizationId: { in: state.orgIds } } },
              { assignedTo: { organizationId: { in: state.orgIds } } }
            ]
          }
        })
        await tx.property.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.user.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.team.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.branch.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.organization.deleteMany({ where: { id: { in: state.orgIds } } })
      })
    }
  } finally {
    await shutdown()
  }
})

test('ADMIN can invite users with privileged roles, hierarchy, contact details, and targets', async () => {
  const email = `${tag.toLowerCase()}-invited@example.invalid`
  const response = await apiWithConflictRetry('POST', '/api/users', {
    token: state.tokens.ADMIN_A,
    body: {
      email,
      password: 'Invited30!',
      role: 'TEAM_LEAD',
      firstName: 'Invited Lead',
      phone: '+20 100 777 8899',
      jobTitle: 'Team Lead',
      avatarUrl: 'https://cdn.example.test/avatars/lead.png',
      preferredLang: 'ar',
      monthlyTargetAmount: 350000,
      branchId: state.branchId,
      teamId: state.teamId,
      isActive: true
    }
  })
  assert.equal(response.status, 201, JSON.stringify(response.data))
  const created = response.data.data
  assert.equal(created.role, 'TEAM_LEAD')
  assert.equal(created.phone, '+20 100 777 8899')
  assert.equal(created.jobTitle, 'Team Lead')
  assert.equal(created.preferredLang, 'ar')
  assert.equal(created.monthlyTargetAmount, 350000)
  assert.equal(created.branchId, state.branchId)
  assert.equal(created.teamId, state.teamId)
  assert.equal(created.deletedAt, null)
  assert.ok(!Object.keys(created).includes('password'))

  const stored = await prisma.user.findUnique({
    where: { id: created.id },
    select: { role: true, phone: true, monthlyTargetAmount: true, password: true }
  })
  assert.equal(stored.role, 'TEAM_LEAD')
  assert.equal(Number(stored.monthlyTargetAmount), 350000)
  assert.notEqual(stored.password, 'Invited30!')

  const audit = await prisma.auditLog.findFirst({
    where: { action: 'USER_CREATED', entityId: created.id },
    select: { id: true }
  })
  assert.ok(audit)

  const login = await api('POST', '/api/auth/login', { body: { email, password: 'Invited30!' } })
  assert.equal(login.status, 200, JSON.stringify(login.data))
})

test('MANAGER cannot create, edit, or deactivate ADMIN accounts', async () => {
  const created = await api('POST', '/api/users', {
    token: state.tokens.MANAGER_A,
    body: {
      email: `${tag.toLowerCase()}-manager-admin@example.invalid`,
      password: 'ManagerAdmin1!',
      role: 'ADMIN'
    }
  })
  assert.equal(created.status, 403)

  const patched = await api('PATCH', `/api/users/${state.users.ADMIN_A.id}`, {
    token: state.tokens.MANAGER_A,
    body: { firstName: 'Should not change' }
  })
  assert.equal(patched.status, 403)

  const deleted = await api('DELETE', `/api/users/${state.users.ADMIN_A.id}`, {
    token: state.tokens.MANAGER_A
  })
  assert.equal(deleted.status, 403)

  const stored = await prisma.user.findUnique({
    where: { id: state.users.ADMIN_A.id },
    select: { isActive: true, deletedAt: true }
  })
  assert.equal(stored.isActive, true)
  assert.equal(stored.deletedAt, null)
})

test('self guards and ADMIN-only password reset revoke affected sessions', async () => {
  const selfRole = await api('PATCH', `/api/users/${state.users.ADMIN_A.id}`, {
    token: state.tokens.ADMIN_A,
    body: { role: 'AGENT' }
  })
  assert.equal(selfRole.status, 403)

  const selfDeactivate = await api('PATCH', `/api/users/${state.users.ADMIN_A.id}`, {
    token: state.tokens.ADMIN_A,
    body: { isActive: false }
  })
  assert.equal(selfDeactivate.status, 400)

  const selfPassword = await api('PATCH', `/api/users/${state.users.ADMIN_A.id}`, {
    token: state.tokens.ADMIN_A,
    body: { password: 'SelfReset1!' }
  })
  assert.equal(selfPassword.status, 400)

  const target = state.users.AGENT_A
  const managerReset = await api('PATCH', `/api/users/${target.id}`, {
    token: state.tokens.MANAGER_A,
    body: { password: 'ManagerReset1!' }
  })
  assert.equal(managerReset.status, 403)

  const newPassword = `AdminReset30!${crypto.randomBytes(6).toString('hex')}`
  const adminReset = await apiWithConflictRetry('PATCH', `/api/users/${target.id}`, {
    token: state.tokens.ADMIN_A,
    body: { password: newPassword, monthlyTargetAmount: 275000 }
  })
  assert.equal(adminReset.status, 200, JSON.stringify(adminReset.data))
  assert.equal(adminReset.data.data.monthlyTargetAmount, 275000)

  const revoked = await api('GET', '/api/auth/me', { token: state.tokens.AGENT_A })
  assert.equal(revoked.status, 401)
  assert.match(revoked.data.error.message, /revoked/i)

  const oldLogin = await api('POST', '/api/auth/login', {
    body: { email: target.email, password: state.passwords.AGENT_A }
  })
  assert.equal(oldLogin.status, 401)

  const freshLogin = await api('POST', '/api/auth/login', { body: { email: target.email, password: newPassword } })
  assert.equal(freshLogin.status, 200, JSON.stringify(freshLogin.data))
  state.tokens.AGENT_A = freshLogin.data.data.token
  state.passwords.AGENT_A = newPassword

  const audit = await prisma.auditLog.findFirst({
    where: { entityId: target.id, action: 'USER_PASSWORD_RESET' },
    select: { id: true }
  })
  assert.ok(audit)
})

test('deactivation blocks login and JWTs; restoration reactivates the account', async () => {
  const target = state.users.AGENT_A
  const oldToken = state.tokens.AGENT_A

  const deactivated = await apiWithConflictRetry('DELETE', `/api/users/${target.id}`, {
    token: state.tokens.ADMIN_A
  })
  assert.equal(deactivated.status, 200, JSON.stringify(deactivated.data))
  assert.equal(deactivated.data.data.isActive, false)
  assert.ok(deactivated.data.data.deletedAt)

  const blockedLogin = await api('POST', '/api/auth/login', {
    body: { email: target.email, password: state.passwords.AGENT_A }
  })
  assert.equal(blockedLogin.status, 401)

  const blockedToken = await api('GET', '/api/auth/me', { token: oldToken })
  assert.equal(blockedToken.status, 401)
  assert.match(blockedToken.data.error.message, /not active|revoked/i)

  const listed = await api('GET', '/api/users?includeInactive=true&limit=100', { token: state.tokens.ADMIN_A })
  assert.equal(listed.status, 200)
  const row = listed.data.data.find((user) => user.id === target.id)
  assert.ok(row)
  assert.equal(row.isActive, false)

  const audit = await prisma.auditLog.findFirst({
    where: { entityId: target.id, action: 'USER_DEACTIVATED' },
    select: { id: true }
  })
  assert.ok(audit)

  const restored = await api('POST', `/api/users/${target.id}/restore`, { token: state.tokens.ADMIN_A })
  assert.equal(restored.status, 200, JSON.stringify(restored.data))
  assert.equal(restored.data.data.isActive, true)
  assert.equal(restored.data.data.deletedAt, null)

  const freshLogin = await api('POST', '/api/auth/login', {
    body: { email: target.email, password: state.passwords.AGENT_A }
  })
  assert.equal(freshLogin.status, 200, JSON.stringify(freshLogin.data))
  state.tokens.AGENT_A = freshLogin.data.data.token
})

test('concurrent ADMIN demotions cannot remove the last active ADMIN', async () => {
  const [first, second] = await Promise.all([
    apiWithConflictRetry('PATCH', `/api/users/${state.users.ADMIN_C1.id}`, {
      token: state.tokens.ADMIN_C2,
      body: { role: 'MANAGER' }
    }),
    apiWithConflictRetry('PATCH', `/api/users/${state.users.ADMIN_C2.id}`, {
      token: state.tokens.ADMIN_C1,
      body: { role: 'MANAGER' }
    })
  ])
  const statuses = [first.status, second.status]
  assert.equal(statuses.filter((status) => status === 200).length, 1)
  assert.ok(statuses.some((status) => [400, 401, 409].includes(status)), statuses.join(','))

  const remaining = await prisma.user.findMany({
    where: {
      id: { in: [state.users.ADMIN_C1.id, state.users.ADMIN_C2.id] },
      role: 'ADMIN',
      isActive: true,
      deletedAt: null
    },
    select: { id: true }
  })
  assert.equal(remaining.length, 1)
})

test('admin user list exposes last login and active lead/deal counts with tenant isolation', async () => {
  const response = await api('GET', '/api/users?limit=100', { token: state.tokens.ADMIN_A })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  const row = response.data.data.find((user) => user.id === state.users.AGENT_A.id)
  assert.ok(row)
  assert.ok(row.lastLoginAt)
  assert.ok(row.activeLeads >= 1)
  assert.ok(row.activeDeals >= 1)
  assert.equal(row.assignedCounts.leads, row.activeLeads)
  assert.equal(row.assignedCounts.deals, row.activeDeals)
  assert.equal(row.monthlyTargetAmount, 275000)

  const crossTenant = await api('PATCH', `/api/users/${state.users.AGENT_A.id}`, {
    token: state.tokens.ADMIN_B,
    body: { firstName: 'Cross tenant edit' }
  })
  assert.equal(crossTenant.status, 404)
})

test('frontend admin UI and demo seed expose lifecycle controls bilingually', () => {
  const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
  const resources = read('frontend/src/config/resources.ts')
  const resourceView = read('frontend/src/views/ResourceView.vue')
  const seed = read('scripts/seed-demo.cjs')

  assert.match(resources, /monthlyTargetAmount/)
  assert.match(resources, /activeLeads/)
  assert.match(resources, /activeDeals/)
  assert.match(resources, /lastLoginAt/)
  assert.match(resourceView, /resetUserPassword/)
  assert.match(resourceView, /restoreUser/)
  assert.match(resourceView, /includeInactive/)
  assert.match(resourceView, /إعادة تعيين كلمة المرور/)
  assert.match(seed, /monthlyTargetAmount: 250000/)
  assert.match(seed, /demo-team-lead/)
})
