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
const tag = `PKG27-${runId}`
const state = {
  orgAId: null,
  orgBId: null,
  branchA1Id: null,
  branchA2Id: null,
  teamA1Id: null,
  users: {},
  tokens: {},
  propertyIds: {},
  leadIds: {},
  dealIds: {}
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

async function createUser(key, organizationId, role, overrides = {}) {
  const password = `Package27!${crypto.randomBytes(10).toString('base64url')}`
  const user = await prisma.user.create({
    data: {
      email: `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`,
      password: await bcrypt.hash(password, 4),
      role,
      organizationId,
      firstName: `Package ${key}`,
      isActive: true,
      ...overrides
    },
    select: { id: true, email: true }
  })
  state.users[key] = user
  const login = await api('POST', '/api/auth/login', { body: { email: user.email, password } })
  assert.equal(login.status, 200, `${key} login should succeed: ${JSON.stringify(login.data)}`)
  state.tokens[key] = login.data.data.token
  return user
}

async function createProperty(key, organizationId, assignedAgentId, grouping = {}) {
  const property = await prisma.property.create({
    data: {
      referenceNumber: `${tag}-PROP-${key}`,
      title: `${tag} ${key}`,
      type: 'APARTMENT',
      organizationId,
      assignedAgentId,
      ...grouping
    },
    select: { id: true }
  })
  state.propertyIds[key] = property.id
  return property.id
}

async function createLead(key, _organizationId, assignedToId, grouping = {}) {
  const lead = await prisma.lead.create({
    data: {
      firstName: `${tag} ${key}`,
      assignedToId,
      ...grouping
    },
    select: { id: true }
  })
  state.leadIds[key] = lead.id
  return lead.id
}

async function createDeal(key, organizationId, userId, grouping = {}) {
  const deal = await prisma.deal.create({
    data: {
      referenceNumber: `${tag}-DEAL-${key}`,
      type: 'SALE',
      status: 'DRAFT',
      propertyId: state.propertyIds[key.startsWith('otherTenant') ? 'otherTenant' : key.replace(/^deal/, '')],
      organizationId,
      userId,
      amount: 1000,
      ...grouping
    },
    select: { id: true }
  })
  state.dealIds[key] = deal.id
  return deal.id
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  state.orgAId = await createOrg('a')
  state.orgBId = await createOrg('b')

  await createUser('ADMIN_A', state.orgAId, 'ADMIN')
  await createUser('AGENT_A1', state.orgAId, 'AGENT')
  await createUser('AGENT_A2', state.orgAId, 'AGENT')
  await createUser('AGENT_A_BRANCH2', state.orgAId, 'AGENT')
  await createUser('ADMIN_B', state.orgBId, 'ADMIN')
  await createUser('AGENT_B', state.orgBId, 'AGENT')
  await createUser('TEAM_LEAD_A', state.orgAId, 'TEAM_LEAD')

  const branch1 = await api('POST', '/api/hierarchy/branches', {
    token: state.tokens.ADMIN_A,
    body: { name: `${tag} Branch 1`, nameAr: 'الفرع الأول', code: 'BR1' }
  })
  assert.equal(branch1.status, 201, JSON.stringify(branch1.data))
  state.branchA1Id = branch1.data.data.id
  const branch2 = await api('POST', '/api/hierarchy/branches', {
    token: state.tokens.ADMIN_A,
    body: { name: `${tag} Branch 2`, nameAr: 'الفرع الثاني', code: 'BR2' }
  })
  assert.equal(branch2.status, 201, JSON.stringify(branch2.data))
  state.branchA2Id = branch2.data.data.id

  const team = await api('POST', '/api/hierarchy/teams', {
    token: state.tokens.ADMIN_A,
    body: { name: `${tag} Team 1`, nameAr: 'الفريق الأول', branchId: state.branchA1Id, leaderId: state.users.TEAM_LEAD_A.id }
  })
  assert.equal(team.status, 201, JSON.stringify(team.data))
  state.teamA1Id = team.data.data.id

  for (const [key, branchId, teamId] of [
    ['TEAM_LEAD_A', state.branchA1Id, state.teamA1Id],
    ['AGENT_A1', state.branchA1Id, state.teamA1Id],
    ['AGENT_A2', state.branchA1Id, null],
    ['AGENT_A_BRANCH2', state.branchA2Id, null]
  ]) {
    const response = await api('PATCH', `/api/users/${state.users[key].id}`, {
      token: state.tokens.ADMIN_A,
      body: { branchId, teamId }
    })
    assert.equal(response.status, 200, `${key} assignment failed: ${JSON.stringify(response.data)}`)
  }

  const teamGroup = { branchId: state.branchA1Id, teamId: state.teamA1Id }
  const branchGroup = { branchId: state.branchA1Id }
  const branch2Group = { branchId: state.branchA2Id }

  await createProperty('pOwn', state.orgAId, state.users.TEAM_LEAD_A.id, teamGroup)
  await createProperty('pTeam', state.orgAId, state.users.AGENT_A1.id, teamGroup)
  await createProperty('pBranch', state.orgAId, state.users.AGENT_A2.id, branchGroup)
  await createProperty('pBranch2', state.orgAId, state.users.AGENT_A_BRANCH2.id, branch2Group)
  await createProperty('otherTenant', state.orgBId, state.users.AGENT_B.id)

  await createLead('lOwn', state.orgAId, state.users.TEAM_LEAD_A.id, teamGroup)
  await createLead('lTeam', state.orgAId, state.users.AGENT_A1.id, teamGroup)
  await createLead('lBranch', state.orgAId, state.users.AGENT_A2.id, branchGroup)
  await createLead('lBranch2', state.orgAId, state.users.AGENT_A_BRANCH2.id, branch2Group)
  await createLead('lOtherTenant', state.orgBId, state.users.AGENT_B.id)

  await createDeal('dealpOwn', state.orgAId, state.users.TEAM_LEAD_A.id, teamGroup)
  await createDeal('dealpTeam', state.orgAId, state.users.AGENT_A1.id, teamGroup)
  await createDeal('dealpBranch', state.orgAId, state.users.AGENT_A2.id, branchGroup)
  await createDeal('dealpBranch2', state.orgAId, state.users.AGENT_A_BRANCH2.id, branch2Group)
  await createDeal('dealotherTenant', state.orgBId, state.users.AGENT_B.id)
})

test.after(async () => {
  try {
    const orgIds = [state.orgAId, state.orgBId].filter(Boolean)
    if (orgIds.length) {
      const users = await prisma.user.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } })
      const userIds = users.map((user) => user.id)
      const dealIds = Object.values(state.dealIds)
      await prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { organizationId: { in: orgIds } }] } })
        await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })
        await tx.dealClosingChecklist.deleteMany({ where: { dealId: { in: dealIds } } })
        await tx.deal.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.leadNote.deleteMany({ where: { authorId: { in: userIds } } })
        await tx.lead.deleteMany({ where: { OR: [{ assignedToId: { in: userIds } }, { property: { organizationId: { in: orgIds } } }] } })
        await tx.property.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.team.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.branch.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: orgIds } } })
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } })
      })
    }
  } finally {
    await shutdown()
  }
})

test('role matrix and frontend labels expose TEAM_LEAD bilingually', async () => {
  const response = await api('GET', '/api/settings/permissions', { token: state.tokens.ADMIN_A })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.ok(response.data.data.roles.includes('TEAM_LEAD'))
  assert.equal(response.data.data.matrix.TEAM_LEAD['properties.view'], true)
  assert.equal(response.data.data.matrix.TEAM_LEAD['users.manage'], false)

  const root = path.resolve(__dirname, '..')
  const permissions = fs.readFileSync(path.join(root, 'frontend/src/config/permissions.ts'), 'utf8')
  const resources = fs.readFileSync(path.join(root, 'frontend/src/config/resources.ts'), 'utf8')
  assert.match(permissions, /TEAM_LEAD: \['Team Lead', 'قائد الفريق'\]/)
  assert.match(resources, /معرّف الفرع/)
  assert.match(resources, /معرّف الفريق/)
})

test('team lead sees own, team and branch properties but never another branch or tenant', async () => {
  const response = await api('GET', '/api/properties?limit=100', { token: state.tokens.TEAM_LEAD_A })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  const ids = new Set(response.data.data.map((row) => row.id))
  assert.ok(ids.has(state.propertyIds.pOwn))
  assert.ok(ids.has(state.propertyIds.pTeam))
  assert.ok(ids.has(state.propertyIds.pBranch))
  assert.equal(ids.has(state.propertyIds.pBranch2), false)
  assert.equal(ids.has(state.propertyIds.otherTenant), false)

  const admin = await api('GET', '/api/properties?limit=100', { token: state.tokens.ADMIN_A })
  assert.equal(admin.status, 200)
  const adminIds = new Set(admin.data.data.map((row) => row.id))
  assert.ok(adminIds.has(state.propertyIds.pBranch2))
  assert.equal(adminIds.has(state.propertyIds.otherTenant), false)

  const agent = await api('GET', '/api/properties?limit=100', { token: state.tokens.AGENT_A1 })
  assert.equal(agent.status, 200)
  const agentIds = new Set(agent.data.data.map((row) => row.id))
  assert.deepEqual([...agentIds], [state.propertyIds.pTeam])
})

test('team lead detail endpoints enforce the same scope', async () => {
  const visible = await api('GET', `/api/properties/${state.propertyIds.pTeam}`, { token: state.tokens.TEAM_LEAD_A })
  assert.equal(visible.status, 200, JSON.stringify(visible.data))
  const hidden = await api('GET', `/api/properties/${state.propertyIds.pBranch2}`, { token: state.tokens.TEAM_LEAD_A })
  assert.equal(hidden.status, 403)
  const otherTenant = await api('GET', `/api/properties/${state.propertyIds.otherTenant}`, { token: state.tokens.TEAM_LEAD_A })
  assert.equal(otherTenant.status, 404)
})

test('leads and deals follow the same team, branch and tenant boundaries', async () => {
  const leads = await api('GET', '/api/leads?limit=100', { token: state.tokens.TEAM_LEAD_A })
  assert.equal(leads.status, 200, JSON.stringify(leads.data))
  const leadIds = new Set(leads.data.data.map((row) => row.id))
  assert.ok(leadIds.has(state.leadIds.lOwn))
  assert.ok(leadIds.has(state.leadIds.lTeam))
  assert.ok(leadIds.has(state.leadIds.lBranch))
  assert.equal(leadIds.has(state.leadIds.lBranch2), false)
  assert.equal(leadIds.has(state.leadIds.lOtherTenant), false)

  const deals = await api('GET', '/api/deals?limit=100', { token: state.tokens.TEAM_LEAD_A })
  assert.equal(deals.status, 200, JSON.stringify(deals.data))
  const dealIds = new Set(deals.data.data.map((row) => row.id))
  assert.ok(dealIds.has(state.dealIds.dealpOwn))
  assert.ok(dealIds.has(state.dealIds.dealpTeam))
  assert.ok(dealIds.has(state.dealIds.dealpBranch))
  assert.equal(dealIds.has(state.dealIds.dealpBranch2), false)
  assert.equal(dealIds.has(state.dealIds.dealotherTenant), false)

  const hiddenDeal = await api('GET', `/api/deals/${state.dealIds.dealpBranch2}`, { token: state.tokens.TEAM_LEAD_A })
  assert.equal(hiddenDeal.status, 404)
})

test('users management stays with admins while team leads get a scoped read-only list', async () => {
  const users = await api('GET', '/api/users?limit=100', { token: state.tokens.TEAM_LEAD_A })
  assert.equal(users.status, 200, JSON.stringify(users.data))
  const ids = new Set(users.data.data.map((row) => row.id))
  assert.ok(ids.has(state.users.TEAM_LEAD_A.id))
  assert.ok(ids.has(state.users.AGENT_A1.id))
  assert.ok(ids.has(state.users.AGENT_A2.id))
  assert.equal(ids.has(state.users.AGENT_A_BRANCH2.id), false)
  assert.equal(ids.has(state.users.AGENT_B.id), false)

  const denied = await api('PATCH', `/api/users/${state.users.AGENT_A1.id}`, {
    token: state.tokens.TEAM_LEAD_A,
    body: { firstName: 'Nope' }
  })
  assert.equal(denied.status, 403)
})

test('hierarchy endpoints are tenant-scoped and management-only', async () => {
  const denied = await api('GET', '/api/hierarchy/branches', { token: state.tokens.TEAM_LEAD_A })
  assert.equal(denied.status, 403)

  const crossTenantBranch = await api('POST', '/api/hierarchy/teams', {
    token: state.tokens.ADMIN_B,
    body: { name: `${tag} Cross Tenant`, branchId: state.branchA1Id }
  })
  assert.equal(crossTenantBranch.status, 404)

  const crossTenantUser = await api('PATCH', `/api/users/${state.users.AGENT_A1.id}`, {
    token: state.tokens.ADMIN_B,
    body: { branchId: state.branchA1Id }
  })
  assert.equal(crossTenantUser.status, 404)

  const listB = await api('GET', '/api/hierarchy/branches?limit=100', { token: state.tokens.ADMIN_B })
  assert.equal(listB.status, 200)
  assert.deepEqual(listB.data.data, [])
})
