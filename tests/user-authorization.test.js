const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const bcrypt = require('bcrypt')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.NODE_ENV = 'test'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `AUTHZ1-${runId}`

const state = {
  orgAId: null,
  orgBId: null,
  orgCId: null,
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
  const password = `Authz1!${crypto.randomBytes(12).toString('base64url')}`
  const user = await prisma.user.create({
    data: {
      email: `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`,
      password: await bcrypt.hash(password, 10),
      role,
      organizationId,
      firstName: `Authz ${key}`,
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

async function login(key) {
  const response = await api('POST', '/api/auth/login', {
    body: { email: state.users[key].email, password: state.passwords[key] }
  })
  assert.equal(response.status, 200, `${key} login should succeed`)
  assert.ok(response.data.data.token, `${key} login should return a token`)
  state.tokens[key] = response.data.data.token
}

async function apiWithConflictRetry(method, path, options = {}, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await api(method, path, options)
    if (response.status !== 409 || attempt === attempts) return response
  }
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
      organizationId: true
    }
  })
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  state.orgAId = await createOrganization('single-admin')
  state.orgBId = await createOrganization('multi-admin')
  state.orgCId = await createOrganization('concurrent-admins')

  await createUser('ADMIN_A', state.orgAId, 'ADMIN')
  await createUser('MANAGER_A', state.orgAId, 'MANAGER')
  await createUser('AGENT_A', state.orgAId, 'AGENT')

  await createUser('ADMIN_B1', state.orgBId, 'ADMIN')
  await createUser('ADMIN_B2', state.orgBId, 'ADMIN')
  await createUser('ADMIN_B3', state.orgBId, 'ADMIN')
  await createUser('MANAGER_B', state.orgBId, 'MANAGER')
  await createUser('ADMIN_C1', state.orgCId, 'ADMIN')
  await createUser('ADMIN_C2', state.orgCId, 'ADMIN')

  for (const key of Object.keys(state.users)) {
    await login(key)
  }
})

test.after(async () => {
  try {
    const orgIds = [state.orgAId, state.orgBId, state.orgCId].filter(Boolean)
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

test('MANAGER cannot create an ADMIN', async () => {
  const email = `${tag.toLowerCase()}-manager-admin-denied@example.invalid`
  const response = await api('POST', '/api/users', {
    token: state.tokens.MANAGER_A,
    body: { email, password: 'Authz1Password1', role: 'ADMIN' }
  })

  assert.equal(response.status, 403)
  assert.equal(response.data.success, false)
  assert.match(response.data.error.message, /MANAGER accounts cannot create ADMIN/i)
  assert.equal(await prisma.user.findUnique({ where: { email } }), null)
})

test('MANAGER cannot promote another user to ADMIN', async () => {
  const target = state.users.AGENT_A
  const response = await api('PATCH', `/api/users/${target.id}`, {
    token: state.tokens.MANAGER_A,
    body: { role: 'ADMIN' }
  })

  assert.equal(response.status, 403)
  assert.match(response.data.error.message, /MANAGER accounts cannot promote/i)
  const after = await dbUser(target.id)
  assert.equal(after.role, 'AGENT')
})

test('MANAGER cannot modify an existing ADMIN account', async () => {
  const target = state.users.ADMIN_A
  const response = await api('PATCH', `/api/users/${target.id}`, {
    token: state.tokens.MANAGER_A,
    body: { firstName: 'Unauthorized Manager Edit' }
  })

  assert.equal(response.status, 403)
  assert.match(response.data.error.message, /MANAGER accounts cannot manage ADMIN/i)
  const after = await dbUser(target.id)
  assert.equal(after.firstName, target.firstName)
})

test('MANAGER cannot deactivate an ADMIN via DELETE or PATCH', async () => {
  const target = state.users.ADMIN_A

  const deleteResponse = await api('DELETE', `/api/users/${target.id}`, {
    token: state.tokens.MANAGER_A
  })
  assert.equal(deleteResponse.status, 403)

  const patchResponse = await api('PATCH', `/api/users/${target.id}`, {
    token: state.tokens.MANAGER_A,
    body: { isActive: false }
  })
  assert.equal(patchResponse.status, 403)

  const after = await dbUser(target.id)
  assert.equal(after.isActive, true)
  assert.equal(after.deletedAt, null)
})

test('No user can change their own role', async () => {
  const attempts = [
    { key: 'ADMIN_A', nextRole: 'MANAGER' },
    { key: 'MANAGER_A', nextRole: 'ADMIN' }
  ]

  for (const attempt of attempts) {
    const target = state.users[attempt.key]
    const response = await api('PATCH', `/api/users/${target.id}`, {
      token: state.tokens[attempt.key],
      body: { role: attempt.nextRole, firstName: 'Should Not Be Applied' }
    })

    assert.equal(response.status, 403)
    assert.match(response.data.error.message, /cannot change your own role/i)
    const after = await dbUser(target.id)
    assert.equal(after.role, target.role)
    assert.equal(after.firstName, target.firstName)
  }
})

test('Users can still update permitted profile fields without changing their role', async () => {
  for (const key of ['ADMIN_A', 'MANAGER_A']) {
    const target = state.users[key]
    const updatedName = `Updated ${key}`
    const response = await apiWithConflictRetry('PATCH', `/api/users/${target.id}`, {
      token: state.tokens[key],
      body: { firstName: updatedName }
    })

    assert.equal(response.status, 200)
    assert.equal(response.data.data.role, target.role)
    const after = await dbUser(target.id)
    assert.equal(after.firstName, updatedName)
    assert.equal(after.role, target.role)
  }
})

test('ADMIN can perform legitimate user-management operations', async () => {
  const email = `${tag.toLowerCase()}-admin-created@example.invalid`
  const createdResponse = await api('POST', '/api/users', {
    token: state.tokens.ADMIN_B1,
    body: { email, password: 'Authz1Password1', role: 'AGENT', firstName: 'Admin Created' }
  })
  assert.equal(createdResponse.status, 201)
  const created = createdResponse.data.data
  assert.equal(created.role, 'AGENT')

  const promotedResponse = await apiWithConflictRetry('PATCH', `/api/users/${created.id}`, {
    token: state.tokens.ADMIN_B1,
    body: { role: 'MANAGER', firstName: 'Promoted By Admin' }
  })
  assert.equal(promotedResponse.status, 200)
  assert.equal(promotedResponse.data.data.role, 'MANAGER')

  const updatedResponse = await apiWithConflictRetry('PATCH', `/api/users/${created.id}`, {
    token: state.tokens.ADMIN_B1,
    body: { firstName: 'Final Admin Edit' }
  })
  assert.equal(updatedResponse.status, 200)
  assert.equal(updatedResponse.data.data.firstName, 'Final Admin Edit')

  const deactivatedResponse = await apiWithConflictRetry('DELETE', `/api/users/${created.id}`, {
    token: state.tokens.ADMIN_B1
  })
  assert.equal(deactivatedResponse.status, 200)
  const after = await dbUser(created.id)
  assert.equal(after.isActive, false)
  assert.ok(after.deletedAt)
})

test('Last active ADMIN cannot deactivate themselves', async () => {
  const target = state.users.ADMIN_A
  const selfResponse = await api('PATCH', `/api/users/${target.id}`, {
    token: state.tokens.ADMIN_A,
    body: { isActive: false }
  })
  assert.equal(selfResponse.status, 400)
  assert.match(selfResponse.data.error.message, /own account/i)

  // A manager in the same organization cannot deactivate the ADMIN either.
  const managerResponse = await api('PATCH', `/api/users/${target.id}`, {
    token: state.tokens.MANAGER_A,
    body: { isActive: false }
  })
  assert.equal(managerResponse.status, 403)

  const after = await dbUser(target.id)
  assert.equal(after.isActive, true)
})

test('Last active ADMIN cannot be demoted', async () => {
  const target = state.users.ADMIN_A

  const selfResponse = await api('PATCH', `/api/users/${target.id}`, {
    token: state.tokens.ADMIN_A,
    body: { role: 'MANAGER' }
  })
  assert.equal(selfResponse.status, 403)

  const managerResponse = await api('PATCH', `/api/users/${target.id}`, {
    token: state.tokens.MANAGER_A,
    body: { role: 'MANAGER' }
  })
  assert.equal(managerResponse.status, 403)

  const after = await dbUser(target.id)
  assert.equal(after.role, 'ADMIN')
})

test('Multiple active ADMINs can still deactivate or demote one ADMIN', async () => {
  const deactivateResponse = await apiWithConflictRetry('PATCH', `/api/users/${state.users.ADMIN_B2.id}`, {
    token: state.tokens.ADMIN_B1,
    body: { isActive: false }
  })
  assert.equal(deactivateResponse.status, 200)
  const deactivated = await dbUser(state.users.ADMIN_B2.id)
  assert.equal(deactivated.isActive, false)

  const demoteResponse = await apiWithConflictRetry('PATCH', `/api/users/${state.users.ADMIN_B3.id}`, {
    token: state.tokens.ADMIN_B1,
    body: { role: 'MANAGER' }
  })
  assert.equal(demoteResponse.status, 200)
  const demoted = await dbUser(state.users.ADMIN_B3.id)
  assert.equal(demoted.role, 'MANAGER')
})

test('Concurrent demotions cannot remove the last active ADMIN', async () => {
  const [first, second] = await Promise.all([
    api('PATCH', `/api/users/${state.users.ADMIN_C1.id}`, {
      token: state.tokens.ADMIN_C2,
      body: { role: 'MANAGER' }
    }),
    api('PATCH', `/api/users/${state.users.ADMIN_C2.id}`, {
      token: state.tokens.ADMIN_C1,
      body: { role: 'MANAGER' }
    })
  ])

  const statuses = [first.status, second.status]
  assert.equal(statuses.filter((status) => status === 200).length, 1)
  assert.ok(
    statuses.some((status) => [400, 401, 403, 409].includes(status)),
    `expected one rejected concurrent demotion, got ${statuses.join(',')}`
  )
  // A demotion revokes the target's tokens, so a concurrent demotion by that
  // user is rejected as a revoked session rather than silently succeeding.
  const rejected = [first, second].find((response) => response.status !== 200)
  assert.ok(
    [400, 401, 403, 409].includes(rejected.status) &&
      (rejected.status !== 401 || /revoked/i.test(rejected.data.error.message)),
    `unexpected rejection: ${rejected.status} ${JSON.stringify(rejected.data)}`
  )

  const afterFirst = await dbUser(state.users.ADMIN_C1.id)
  const afterSecond = await dbUser(state.users.ADMIN_C2.id)
  const remainingActiveAdmins = [afterFirst, afterSecond].filter(
    (user) => user.role === 'ADMIN' && user.isActive
  )
  assert.equal(remainingActiveAdmins.length, 1)
})

test('Existing organization isolation is preserved for user management', async () => {
  const response = await api('PATCH', `/api/users/${state.users.ADMIN_B1.id}`, {
    token: state.tokens.MANAGER_A,
    body: { firstName: 'Cross Organization Edit' }
  })

  assert.equal(response.status, 404)
  const after = await dbUser(state.users.ADMIN_B1.id)
  assert.notEqual(after.firstName, 'Cross Organization Edit')
})
