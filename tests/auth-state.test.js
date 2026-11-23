const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.NODE_ENV = 'test'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `AUTHSTATE-${runId}`

const state = {
  orgAId: null,
  orgBId: null,
  users: {},
  passwords: {},
  tokens: {}
}

let baseUrl
let server

async function api(method, path, options = {}) {
  const headers = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  return { status: response.status, data }
}

async function apiWithConflictRetry(method, path, options = {}, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await api(method, path, options)
    if (response.status !== 409 || attempt === attempts) return response
  }
}

async function createOrganization(suffix) {
  const organization = await prisma.organization.create({
    data: {
      name: `${tag} ${suffix}`,
      slug: `${tag.toLowerCase()}-${suffix.toLowerCase()}`,
      currency: 'USD',
      baseCurrency: 'USD'
    },
    select: { id: true }
  })
  return organization.id
}

async function createUser(key, organizationId, role) {
  const password = `AuthState1!${crypto.randomBytes(12).toString('base64url')}`
  const user = await prisma.user.create({
    data: {
      email: `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`,
      password: await bcrypt.hash(password, 10),
      role,
      organizationId,
      firstName: `AuthState ${key}`,
      isActive: true
    },
    select: {
      id: true,
      email: true,
      role: true,
      organizationId: true,
      firstName: true,
      isActive: true
    }
  })
  state.users[key] = user
  state.passwords[key] = password
  return user
}

async function loginToken(key, password = state.passwords[key]) {
  const response = await api('POST', '/api/auth/login', {
    body: { email: state.users[key].email, password }
  })
  assert.equal(response.status, 200, `${key} login should succeed`)
  assert.ok(response.data.data.token, `${key} login should return a token`)
  return response.data.data.token
}

async function login(key) {
  state.tokens[key] = await loginToken(key)
}

async function dbUser(id) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      isActive: true,
      deletedAt: true,
      firstName: true,
      organizationId: true,
      accountStatus: true,
      tokenVersion: true
    }
  })
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  state.orgAId = await createOrganization('org-a')
  state.orgBId = await createOrganization('org-b')

  await createUser('ADMIN_A', state.orgAId, 'ADMIN')
  await createUser('MANAGER_A', state.orgAId, 'MANAGER')
  await createUser('AGENT_A', state.orgAId, 'AGENT')
  await createUser('ACCOUNTANT_A', state.orgAId, 'ACCOUNTANT')
  await createUser('ROLE_USER', state.orgAId, 'AGENT')
  await createUser('INACTIVE_USER', state.orgAId, 'AGENT')
  await createUser('DELETED_USER', state.orgAId, 'AGENT')
  await createUser('MOVER', state.orgAId, 'MANAGER')
  await createUser('MOVE_TARGET_A', state.orgAId, 'AGENT')
  await createUser('MOVE_TARGET_B', state.orgBId, 'AGENT')
  await createUser('CROSS_MANAGER', state.orgAId, 'MANAGER')
  await createUser('CROSS_TARGET_B', state.orgBId, 'AGENT')
  await createUser('LOGOUT_USER', state.orgAId, 'AGENT')
  await createUser('STATUS_USER', state.orgAId, 'AGENT')
  await createUser('ORG_STATE_USER', state.orgBId, 'AGENT')
  await createUser('ROTATION_USER', state.orgAId, 'MANAGER')

  for (const key of Object.keys(state.users)) {
    await login(key)
  }
})

test.after(async () => {
  try {
    const orgIds = [state.orgAId, state.orgBId].filter(Boolean)
    if (orgIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { organizationId: { in: orgIds } },
        select: { id: true }
      })
      const userIds = users.map((user) => user.id)
      await prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({
          where: {
            OR: [
              { userId: { in: userIds } },
              { organizationId: { in: orgIds } }
            ]
          }
        })
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } })
      })
    }
  } finally {
    await shutdown()
  }
})

test('valid JWT works while the user remains active', async () => {
  const response = await api('GET', '/api/auth/me', { token: state.tokens.AGENT_A })

  assert.equal(response.status, 200)
  assert.equal(response.data.success, true)
  assert.equal(response.data.data.id, state.users.AGENT_A.id)
  assert.equal(response.data.data.role, 'AGENT')
  assert.ok(!JSON.stringify(response.data).includes('password'))
})

test('database role changes immediately affect permissions for an old JWT', async () => {
  const token = state.tokens.ROLE_USER
  const target = state.users.ROLE_USER

  const before = await api('GET', '/api/users', { token })
  assert.equal(before.status, 403)

  await prisma.user.update({ where: { id: target.id }, data: { role: 'MANAGER' } })
  const promoted = await api('GET', '/api/users', { token })
  assert.equal(promoted.status, 200)

  await prisma.user.update({ where: { id: target.id }, data: { role: 'AGENT' } })
  const demoted = await api('GET', '/api/users', { token })
  assert.equal(demoted.status, 403)

  const after = await dbUser(target.id)
  assert.equal(after.role, 'AGENT')
})

test('deactivating a user immediately invalidates the existing JWT', async () => {
  const token = state.tokens.INACTIVE_USER
  const target = state.users.INACTIVE_USER

  const before = await api('GET', '/api/auth/me', { token })
  assert.equal(before.status, 200)

  await prisma.user.update({ where: { id: target.id }, data: { isActive: false } })

  for (const path of ['/api/auth/me', '/api/properties']) {
    const after = await api('GET', path, { token })
    assert.equal(after.status, 401, `${path} should reject a deactivated user`)
    assert.equal(after.data.success, false)
  }
})

test('deleting a user immediately invalidates the existing JWT', async () => {
  const token = state.tokens.DELETED_USER
  const target = state.users.DELETED_USER

  const before = await api('GET', '/api/auth/me', { token })
  assert.equal(before.status, 200)

  await prisma.user.update({ where: { id: target.id }, data: { deletedAt: new Date() } })

  const after = await api('GET', '/api/auth/me', { token })
  assert.equal(after.status, 401)
  assert.equal(after.data.success, false)
})

test('changing a user organization invalidates the old organization context', async () => {
  const token = state.tokens.MOVER
  const mover = state.users.MOVER
  const targetA = state.users.MOVE_TARGET_A
  const targetB = state.users.MOVE_TARGET_B

  const before = await api('GET', '/api/users', { token })
  assert.equal(before.status, 200)
  assert.ok(before.data.data.some((user) => user.id === targetA.id))
  assert.ok(!before.data.data.some((user) => user.id === targetB.id))

  await prisma.user.update({ where: { id: mover.id }, data: { organizationId: state.orgBId } })

  const after = await api('GET', '/api/users', { token })
  assert.equal(after.status, 200)
  assert.ok(!after.data.data.some((user) => user.id === targetA.id))
  assert.ok(after.data.data.some((user) => user.id === targetB.id))

  const oldOrgPatch = await api('PATCH', `/api/users/${targetA.id}`, {
    token,
    body: { firstName: 'Should Not Apply In Old Org' }
  })
  assert.equal(oldOrgPatch.status, 404)

  const newOrgPatch = await apiWithConflictRetry('PATCH', `/api/users/${targetB.id}`, {
    token,
    body: { firstName: 'Updated In Current Org' }
  })
  assert.equal(newOrgPatch.status, 200)

  const targetAAfter = await dbUser(targetA.id)
  const targetBAfter = await dbUser(targetB.id)
  assert.notEqual(targetAAfter.firstName, 'Should Not Apply In Old Org')
  assert.equal(targetBAfter.firstName, 'Updated In Current Org')
})

test('a user cannot access another organization using an old JWT', async () => {
  const token = state.tokens.CROSS_MANAGER
  const outsideTarget = state.users.CROSS_TARGET_B
  const ownTarget = state.users.MOVE_TARGET_A

  const outside = await api('PATCH', `/api/users/${outsideTarget.id}`, {
    token,
    body: { firstName: 'Cross Org Should Be Denied' }
  })
  assert.equal(outside.status, 404)

  const own = await apiWithConflictRetry('PATCH', `/api/users/${ownTarget.id}`, {
    token,
    body: { firstName: 'Own Org Allowed' }
  })
  assert.equal(own.status, 200)

  const outsideAfter = await dbUser(outsideTarget.id)
  const ownAfter = await dbUser(ownTarget.id)
  assert.notEqual(outsideAfter.firstName, 'Cross Org Should Be Denied')
  assert.equal(ownAfter.firstName, 'Own Org Allowed')
})

test('expired JWTs remain rejected', async () => {
  const token = jwt.sign(
    {
      id: state.users.ADMIN_A.id,
      email: state.users.ADMIN_A.email,
      role: 'ADMIN',
      organizationId: state.orgAId
    },
    process.env.JWT_SECRET,
    { expiresIn: -1 }
  )

  const response = await api('GET', '/api/auth/me', { token })
  assert.equal(response.status, 401)
  assert.match(response.data.error.message, /expired/i)
})

test('invalid, malformed, and forged JWTs remain rejected', async () => {
  const forged = jwt.sign(
    {
      id: state.users.ADMIN_A.id,
      email: state.users.ADMIN_A.email,
      role: 'ADMIN',
      organizationId: state.orgAId
    },
    crypto.randomBytes(32).toString('hex')
  )
  const missingId = jwt.sign({ role: 'ADMIN' }, process.env.JWT_SECRET)

  for (const token of ['not-a-jwt', forged, missingId]) {
    const response = await api('GET', '/api/auth/me', { token })
    assert.equal(response.status, 401)
    assert.equal(response.data.success, false)
  }
})

test('logout revokes the issued token on the server', async () => {
  const user = state.users.LOGOUT_USER
  const token = state.tokens.LOGOUT_USER
  const beforeVersion = (await dbUser(user.id)).tokenVersion

  const before = await api('GET', '/api/auth/me', { token })
  assert.equal(before.status, 200)

  const logout = await api('POST', '/api/auth/logout', { token })
  assert.equal(logout.status, 200)

  const after = await api('GET', '/api/auth/me', { token })
  assert.equal(after.status, 401)
  assert.match(after.data.error.message, /revoked/i)

  const bumped = await dbUser(user.id)
  assert.equal(bumped.tokenVersion, beforeVersion + 1)

  // A fresh login receives the current version and works again.
  state.tokens.LOGOUT_USER = await loginToken('LOGOUT_USER')
  const relogin = await api('GET', '/api/auth/me', { token: state.tokens.LOGOUT_USER })
  assert.equal(relogin.status, 200)
})

test('tokens without a tokenVersion claim are rejected', async () => {
  const token = jwt.sign(
    {
      id: state.users.ADMIN_A.id,
      email: state.users.ADMIN_A.email,
      role: 'ADMIN',
      organizationId: state.orgAId
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  )
  const response = await api('GET', '/api/auth/me', { token })
  assert.equal(response.status, 401)
  assert.match(response.data.error.message, /invalid token payload/i)
})

test('non-active account statuses block requests and login', async () => {
  const user = state.users.STATUS_USER
  const token = state.tokens.STATUS_USER

  try {
    for (const status of ['PENDING', 'REJECTED', 'SUSPENDED']) {
      await prisma.user.update({ where: { id: user.id }, data: { accountStatus: status } })

      const me = await api('GET', '/api/auth/me', { token })
      assert.equal(me.status, 401, `${status} should reject an existing token`)
      assert.match(me.data.error.message, /account is not active/i)

      const login = await api('POST', '/api/auth/login', {
        body: { email: user.email, password: state.passwords.STATUS_USER }
      })
      assert.equal(login.status, 401, `${status} should reject login`)
    }
  } finally {
    await prisma.user.update({ where: { id: user.id }, data: { accountStatus: 'ACTIVE' } })
  }

  state.tokens.STATUS_USER = await loginToken('STATUS_USER')
  const restored = await api('GET', '/api/auth/me', { token: state.tokens.STATUS_USER })
  assert.equal(restored.status, 200)
})

test('an inactive organization blocks tokens and login', async () => {
  const user = state.users.ORG_STATE_USER
  const token = state.tokens.ORG_STATE_USER

  try {
    await prisma.organization.update({ where: { id: state.orgBId }, data: { isActive: false } })

    const me = await api('GET', '/api/auth/me', { token })
    assert.equal(me.status, 401)
    assert.match(me.data.error.message, /organization is not active/i)

    const login = await api('POST', '/api/auth/login', {
      body: { email: user.email, password: state.passwords.ORG_STATE_USER }
    })
    assert.equal(login.status, 401)
  } finally {
    await prisma.organization.update({ where: { id: state.orgBId }, data: { isActive: true } })
  }

  state.tokens.ORG_STATE_USER = await loginToken('ORG_STATE_USER')
  const restored = await api('GET', '/api/auth/me', { token: state.tokens.ORG_STATE_USER })
  assert.equal(restored.status, 200)
})

test('API role and password changes revoke older sessions', async () => {
  const user = state.users.ROTATION_USER
  const adminToken = state.tokens.ADMIN_A
  const firstToken = state.tokens.ROTATION_USER

  const roleChange = await apiWithConflictRetry('PATCH', `/api/users/${user.id}`, {
    token: adminToken,
    body: { role: 'AGENT' }
  })
  assert.equal(roleChange.status, 200)

  const afterRole = await api('GET', '/api/auth/me', { token: firstToken })
  assert.equal(afterRole.status, 401)
  assert.match(afterRole.data.error.message, /revoked/i)

  const secondToken = await loginToken('ROTATION_USER')
  const newPassword = `Rotated1!${crypto.randomBytes(8).toString('hex')}`
  const passwordChange = await apiWithConflictRetry('PATCH', `/api/users/${user.id}`, {
    token: adminToken,
    body: { password: newPassword }
  })
  assert.equal(passwordChange.status, 200)

  const afterPassword = await api('GET', '/api/auth/me', { token: secondToken })
  assert.equal(afterPassword.status, 401)
  assert.match(afterPassword.data.error.message, /revoked/i)

  state.passwords.ROTATION_USER = newPassword
  state.tokens.ROTATION_USER = await loginToken('ROTATION_USER')
  assert.equal((await api('GET', '/api/auth/me', { token: state.tokens.ROTATION_USER })).status, 200)

  const statusChange = await apiWithConflictRetry('PATCH', `/api/users/${user.id}`, {
    token: adminToken,
    body: { accountStatus: 'SUSPENDED', statusReason: 'Security review' }
  })
  assert.equal(statusChange.status, 200)
  const afterStatus = await api('GET', '/api/auth/me', { token: state.tokens.ROTATION_USER })
  assert.equal(afterStatus.status, 401)
})

test('management and finance routes enforce role boundaries', async () => {
  const agentToken = state.tokens.AGENT_A
  const accountantToken = state.tokens.ACCOUNTANT_A
  const managerToken = state.tokens.MANAGER_A

  for (const path of ['/api/users', '/api/settings', '/api/finance/payments', '/api/reports/summary']) {
    const denied = await api('GET', path, { token: agentToken })
    assert.equal(denied.status, 403, `${path} should deny AGENT`)
  }

  assert.equal((await api('GET', '/api/users', { token: accountantToken })).status, 403)
  assert.equal((await api('GET', '/api/settings', { token: accountantToken })).status, 403)
  assert.equal((await api('GET', '/api/finance/payments', { token: accountantToken })).status, 200)
  assert.equal((await api('GET', '/api/reports/summary', { token: accountantToken })).status, 200)
  assert.equal((await api('GET', '/api/users', { token: managerToken })).status, 200)
  assert.equal((await api('GET', '/api/settings', { token: managerToken })).status, 200)
})

test('existing ADMIN authentication and authorization still work', async () => {
  const me = await api('GET', '/api/auth/me', { token: state.tokens.ADMIN_A })
  assert.equal(me.status, 200)
  assert.equal(me.data.data.role, 'ADMIN')

  const users = await api('GET', '/api/users', { token: state.tokens.ADMIN_A })
  assert.equal(users.status, 200)
})

test('existing MANAGER authentication and authorization still work', async () => {
  const me = await api('GET', '/api/auth/me', { token: state.tokens.MANAGER_A })
  assert.equal(me.status, 200)
  assert.equal(me.data.data.role, 'MANAGER')

  const users = await api('GET', '/api/users', { token: state.tokens.MANAGER_A })
  assert.equal(users.status, 200)
})

test('existing AGENT authentication and authorization still work', async () => {
  const token = state.tokens.AGENT_A
  const me = await api('GET', '/api/auth/me', { token })
  assert.equal(me.status, 200)
  assert.equal(me.data.data.role, 'AGENT')

  const properties = await api('GET', '/api/properties', { token })
  assert.equal(properties.status, 200)

  const users = await api('GET', '/api/users', { token })
  assert.equal(users.status, 403)
})

test('existing ACCOUNTANT authentication and authorization still work', async () => {
  const token = state.tokens.ACCOUNTANT_A
  const me = await api('GET', '/api/auth/me', { token })
  assert.equal(me.status, 200)
  assert.equal(me.data.data.role, 'ACCOUNTANT')

  const reports = await api('GET', '/api/reports/summary', { token })
  assert.equal(reports.status, 200)

  const users = await api('GET', '/api/users', { token })
  assert.equal(users.status, 403)
})
