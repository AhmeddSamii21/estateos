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
  attainmentPercent,
  isQuotaPeriod,
  leaderboardCsv,
  quotaForPeriod,
  quotaStatus,
  rankLeaderboard
} = require('../frontend/src/utils/leaderboardCore.mjs')
const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG37-${runId}`
const state = { orgIds: [], userIds: [], tokens: {}, teamId: null, propertyId: null }
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
  return { status: response.status, data: text && isJson ? JSON.parse(text) : null, text, headers: response.headers }
}

async function createOrg(suffix) {
  const org = await prisma.organization.create({
    data: { name: `${tag} ${suffix}`, slug: `${tag.toLowerCase()}-${suffix}`, currency: 'USD', baseCurrency: 'USD' },
    select: { id: true }
  })
  state.orgIds.push(org.id)
  return org.id
}

async function createUser(key, organizationId, role, options = {}) {
  const password = `Leaderboard37!${crypto.randomBytes(8).toString('base64url')}`
  const email = `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`
  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 4),
      role,
      organizationId,
      firstName: `${tag} ${key}`,
      monthlyTargetAmount: options.target ?? null,
      teamId: options.teamId ?? null,
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
  const team = await prisma.team.create({
    data: { organizationId: orgA, name: `${tag} Team` },
    select: { id: true }
  })
  state.teamId = team.id
  const leadId = await createUser('LEAD', orgA, 'TEAM_LEAD', { teamId: team.id })
  await prisma.team.update({ where: { id: team.id }, data: { leaderId: leadId } })
  const agentOne = await createUser('AGENT_ONE', orgA, 'AGENT', { target: 10000, teamId: team.id })
  const agentTwo = await createUser('AGENT_TWO', orgA, 'AGENT', { target: 20000 })
  state.agentOne = agentOne
  state.agentTwo = agentTwo
  await createUser('ADMIN_A', orgA, 'ADMIN')
  const orgB = await createOrg('b')
  await createUser('ADMIN_B', orgB, 'ADMIN')

  const property = await prisma.property.create({
    data: {
      organizationId: orgA,
      referenceNumber: `${tag}-PROPERTY`,
      title: `${tag} Flat`,
      type: 'APARTMENT',
      classification: 'SALE',
      status: 'AVAILABLE',
      price: 11000,
      currency: 'USD',
      area: 90,
      areaUnit: 'SQ_M',
      condition: 'GOOD',
      bedrooms: 2,
      bathrooms: 1
    },
    select: { id: true }
  })
  state.propertyId = property.id

  const lead = await prisma.lead.create({
    data: {
      propertyId: property.id,
      firstName: `${tag} Buyer`,
      status: 'WON',
      assignedToId: agentOne
    },
    select: { id: true }
  })
  state.leadId = lead.id

  for (const [index, userId] of [agentOne, agentOne].entries()) {
    await prisma.deal.create({
      data: {
        organizationId: orgA,
        propertyId: property.id,
        leadId: index === 0 ? lead.id : null,
        userId,
        status: 'ACTIVE',
        amount: index === 0 ? 6000 : 5000,
        baseAmount: index === 0 ? 6000 : 5000,
        currency: 'USD',
        referenceNumber: `${tag}-DEAL-${index}`
      }
    })
  }
  await prisma.deal.create({
    data: {
      organizationId: orgA,
      propertyId: property.id,
      userId: agentTwo,
      status: 'CANCELLED',
      amount: 999999,
      baseAmount: 999999,
      currency: 'USD',
      referenceNumber: `${tag}-CANCELLED`
    }
  })
  await prisma.appointment.create({
    data: {
      title: `${tag} viewing`,
      status: 'COMPLETED',
      startsAt: new Date(),
      userId: agentOne,
      propertyId: property.id,
      leadId: lead.id
    }
  })
})

test.after(async () => {
  try {
    if (state.orgIds.length) {
      await prisma.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { userId: { in: state.userIds } } })
        await tx.appointment.deleteMany({ where: { user: { organizationId: { in: state.orgIds } } } })
        await tx.deal.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.lead.deleteMany({ where: { assignedTo: { organizationId: { in: state.orgIds } } } })
        await tx.property.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.user.updateMany({ where: { id: { in: state.userIds } }, data: { teamId: null } })
        await tx.team.updateMany({ where: { id: state.teamId }, data: { leaderId: null } })
        await tx.user.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.team.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.organization.deleteMany({ where: { id: { in: state.orgIds } } })
      })
    }
  } finally {
    await shutdown()
    if (server?.listening) await new Promise((resolve) => server.close(resolve))
  }
})

test('Package 37: pure quota math scales targets and ranks deterministically', () => {
  assert.equal(isQuotaPeriod('quarter'), true)
  assert.equal(isQuotaPeriod('decade'), false)
  assert.equal(quotaForPeriod(1000, 'month'), 1000)
  assert.equal(quotaForPeriod(1000, 'quarter'), 3000)
  assert.equal(quotaForPeriod(1000, 'year'), 12000)
  assert.equal(quotaForPeriod(1000, 'month', 6), 6000)
  assert.equal(quotaForPeriod(null, 'month'), null)
  assert.equal(attainmentPercent(90, 100), 90)
  assert.equal(attainmentPercent(10, 0), null)
  assert.equal(quotaStatus(null), 'NO_TARGET')
  assert.equal(quotaStatus(49.9), 'BELOW')
  assert.equal(quotaStatus(50), 'NEAR')
  assert.equal(quotaStatus(80), 'ON_TRACK')
  assert.equal(quotaStatus(100), 'EXCEEDED')

  const ranked = rankLeaderboard([
    { userId: 'a', name: 'Amira', role: 'AGENT', monthlyTarget: '10000', value: '5000', dealCount: 1, wonLeadCount: 1, completedAppointmentCount: 1 },
    { userId: 'b', name: 'Omar', role: 'AGENT', monthlyTarget: '10000', value: '11000', dealCount: 2, wonLeadCount: 1, completedAppointmentCount: 2 },
    { userId: 'c', name: 'Layla', role: 'AGENT', monthlyTarget: null, value: '20000', dealCount: 4, wonLeadCount: 2, completedAppointmentCount: 0 }
  ])
  assert.deepEqual(ranked.map((row) => row.userId), ['b', 'a', 'c'])
  assert.equal(ranked[0].attainment, 110)
  assert.equal(ranked[0].status, 'EXCEEDED')
  assert.equal(ranked[2].status, 'NO_TARGET')
  assert.equal(ranked[2].target, null)

  const csv = leaderboardCsv(ranked, 'ar')
  assert.ok(csv.startsWith('\uFEFF'))
  assert.match(csv, /الترتيب,الاسم,الدور/)
  assert.match(csv, /5000/)
})

test('Package 37: management leaderboard aggregates deals, leads and appointments', async () => {
  const response = await api('GET', '/api/leaderboard?period=month', { token: state.tokens.ADMIN_A })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.equal(response.data.data.scope, 'ORGANIZATION')
  assert.equal(response.data.data.period, 'month')
  const top = response.data.data.rows.find((row) => row.userId === state.agentOne)
  assert.ok(top)
  assert.equal(top.rank, 1)
  assert.equal(top.value, '11000.00')
  assert.equal(top.target, '10000.00')
  assert.equal(top.attainment, 110)
  assert.equal(top.status, 'EXCEEDED')
  assert.equal(top.dealCount, 2)
  assert.equal(top.wonLeadCount, 1)
  assert.equal(top.completedAppointmentCount, 1)
  assert.deepEqual(top.currencyBreakdown, [{ currency: 'USD', amount: '11000.00' }])

  const cancelled = response.data.data.rows.find((row) => row.userId === state.agentTwo)
  assert.equal(cancelled.value, '0.00')
  assert.equal(cancelled.dealCount, 0)
  assert.equal(cancelled.status, 'BELOW')
})

test('Package 37: period scaling changes attainment and CSV export is bilingual', async () => {
  const quarter = await api('GET', '/api/leaderboard?period=quarter', { token: state.tokens.ADMIN_A })
  assert.equal(quarter.status, 200)
  const quarterRow = quarter.data.data.rows.find((row) => row.userId === state.agentOne)
  assert.equal(quarterRow.target, '30000.00')
  assert.equal(quarterRow.attainment, 36.7)
  assert.equal(quarterRow.status, 'BELOW')

  const english = await api('GET', '/api/leaderboard?format=csv', { token: state.tokens.ADMIN_A })
  assert.equal(english.status, 200)
  assert.match(english.headers.get('content-type'), /text\/csv/)
  const raw = await fetch(`${baseUrl}/api/leaderboard?format=csv`, {
    headers: { Authorization: `Bearer ${state.tokens.ADMIN_A}` }
  }).then((response) => response.arrayBuffer())
  assert.deepEqual([...new Uint8Array(raw).slice(0, 3)], [0xEF, 0xBB, 0xBF])
  assert.match(english.text, /Rank,Name,Role,Target,Achieved/)

  const arabic = await api('GET', '/api/leaderboard?format=csv&language=ar', { token: state.tokens.ADMIN_A })
  assert.match(arabic.text, /الترتيب,الاسم,الدور/)
})

test('Package 37: agents see only themselves and team leads only their team', async () => {
  const agent = await api('GET', '/api/leaderboard', { token: state.tokens.AGENT_ONE })
  assert.equal(agent.status, 200)
  assert.equal(agent.data.data.scope, 'SELF')
  assert.deepEqual(agent.data.data.rows.map((row) => row.userId), [state.agentOne])

  const lead = await api('GET', '/api/leaderboard', { token: state.tokens.LEAD })
  assert.equal(lead.status, 200)
  assert.equal(lead.data.data.scope, 'TEAM')
  const ids = lead.data.data.rows.map((row) => row.userId).sort()
  assert.deepEqual(ids, [state.agentOne, state.userIds[0]].sort())
})

test('Package 37: leaderboard respects tenant isolation and requires authentication', async () => {
  const other = await api('GET', '/api/leaderboard', { token: state.tokens.ADMIN_B })
  assert.equal(other.status, 200)
  assert.equal(other.data.data.rows.length, 0)

  const anonymous = await api('GET', '/api/leaderboard')
  assert.equal(anonymous.status, 401)
})

test('Package 37: bilingual leaderboard UI and backend route are wired', () => {
  const router = read('frontend/src/router/index.ts')
  assert.match(router, /path: 'leaderboard'/)
  const view = read('frontend/src/views/LeaderboardView.vue')
  assert.match(view, /:dir="store\.direction"/)
  assert.match(view, /لوحة حصص المبيعات/)
  assert.match(view, /Sales quota leaderboard/)
  assert.match(view, /leaderboardCsv/)
  const layout = read('frontend/src/components/Layout.vue')
  assert.match(layout, /to="\/leaderboard"/)
  const index = read('backend/index.ts')
  assert.match(index, /app\.use\('\/api\/leaderboard', leaderboardRoutes\)/)
})
