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
  automationSummary,
  channelLabel,
  dueDate,
  groupTasks,
  renderTemplate,
  taskStatusLabel,
  triggerLabel
} = require('../frontend/src/utils/followUpCore.mjs')
const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG41-${runId}`
const state = {
  orgIds: [],
  userIds: [],
  tokens: {},
  ruleIds: [],
  taskIds: [],
  currentLeadId: null
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
  const isJson = (response.headers.get('content-type') || '').includes('application/json')
  return { status: response.status, data: text && isJson ? JSON.parse(text) : null, text }
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
  const password = `Follow41!${crypto.randomBytes(8).toString('base64url')}`
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

async function createRule(token, payload) {
  const response = await api('POST', '/api/follow-ups/rules', { token, body: payload })
  assert.equal(response.status, 201, JSON.stringify(response.data))
  state.ruleIds.push(response.data.data.id)
  return response.data.data
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const orgA = await createOrg('a')
  const adminA = await createUser('ADMIN_A', orgA, 'ADMIN')
  const leadA = await createUser('LEAD_A', orgA, 'TEAM_LEAD')
  const agentA = await createUser('AGENT_A', orgA, 'AGENT')
  const orgB = await createOrg('b')
  await createUser('ADMIN_B', orgB, 'ADMIN')
  await createUser('AGENT_B', orgB, 'AGENT')
  state.orgA = orgA
  state.orgB = orgB
  state.adminA = adminA
  state.leadA = leadA
  state.agentA = agentA

  const property = await prisma.property.create({
    data: {
      organizationId: orgA,
      referenceNumber: `${tag}-PROPERTY`,
      title: `${tag} Flat`,
      type: 'APARTMENT',
      classification: 'SALE',
      status: 'AVAILABLE',
      price: 100000,
      currency: 'USD',
      area: 100,
      areaUnit: 'SQ_M',
      condition: 'GOOD',
      bedrooms: 2,
      bathrooms: 1
    },
    select: { id: true }
  })
  state.propertyId = property.id

  const currentLead = await prisma.lead.create({
    data: {
      propertyId: property.id,
      firstName: `${tag} Fresh`,
      status: 'NEW',
      assignedToId: agentA
    },
    select: { id: true }
  })
  state.currentLeadId = currentLead.id

  const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
  state.staleLeadId = (await prisma.lead.create({
    data: {
      propertyId: property.id,
      firstName: `${tag} Stale`,
      status: 'QUALIFIED',
      assignedToId: agentA,
      createdAt: staleDate,
      updatedAt: staleDate,
      lastContactedAt: null
    },
    select: { id: true }
  })).id

  await prisma.appointment.create({
    data: {
      title: `${tag} viewing`,
      type: 'VIEWING',
      status: 'COMPLETED',
      startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      userId: agentA,
      propertyId: property.id,
      leadId: currentLead.id
    }
  })

  state.dealId = (await prisma.deal.create({
    data: {
      organizationId: orgA,
      propertyId: property.id,
      userId: agentA,
      status: 'ACTIVE',
      amount: 1000,
      baseAmount: 1000,
      currency: 'USD',
      referenceNumber: `${tag}-DEAL`
    },
    select: { id: true }
  })).id
})

test.after(async () => {
  try {
    if (state.orgIds.length) {
      await prisma.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { userId: { in: state.userIds } } })
        await tx.followUpTask.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.followUpRule.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.appointment.deleteMany({ where: { user: { organizationId: { in: state.orgIds } } } })
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

test('Package 41: pure automation helpers render bilingual templates and group tasks', () => {
  assert.equal(triggerLabel('NEW_LEAD', 'ar'), 'عميل محتمل جديد')
  assert.equal(channelLabel('WHATSAPP', 'en'), 'WhatsApp')
  assert.equal(taskStatusLabel('COMPLETED', 'ar'), 'مكتمل')
  assert.equal(renderTemplate('Call {{client_name}} about {{deal_reference}}', {
    client_name: 'Sara',
    deal_reference: 'D-1'
  }), 'Call Sara about D-1')
  assert.equal(renderTemplate('Keep {{unknown}}', {}), 'Keep {{unknown}}')
  const base = new Date('2026-11-24T00:00:00.000Z')
  assert.equal(dueDate(base, 3), '2026-11-27T00:00:00.000Z')
  assert.equal(dueDate(base, 0), '2026-11-27T00:00:00.000Z')

  const tasks = [
    { id: 'a', status: 'PENDING', dueAt: '2026-11-20T00:00:00.000Z', title: 'a' },
    { id: 'b', status: 'COMPLETED', dueAt: '2026-11-21T00:00:00.000Z', title: 'b' },
    { id: 'c', status: 'PENDING', dueAt: '2099-01-01T00:00:00.000Z', title: 'c' }
  ]
  const grouped = groupTasks(tasks)
  assert.deepEqual(grouped.PENDING.map((task) => task.id), ['a', 'c'])
  const summary = automationSummary(tasks)
  assert.equal(summary.total, 3)
  assert.equal(summary.pending, 2)
  assert.equal(summary.completed, 1)
  assert.equal(summary.overdue, 1)
})

test('Package 41: only management creates rules and tenant data stays isolated', async () => {
  const agentRule = await api('POST', '/api/follow-ups/rules', {
    token: state.tokens.AGENT_A,
    body: { name: 'Agent rule', trigger: 'NEW_LEAD', template: 'Call {{client_name}}' }
  })
  assert.equal(agentRule.status, 403)

  const leadRule = await api('POST', '/api/follow-ups/rules', {
    token: state.tokens.LEAD_A,
    body: { name: 'Lead rule', trigger: 'NEW_LEAD', template: 'Call {{client_name}}' }
  })
  assert.equal(leadRule.status, 403)

  const invalid = await api('POST', '/api/follow-ups/rules', {
    token: state.tokens.ADMIN_A,
    body: { name: 'Invalid', trigger: 'UNKNOWN', template: 'Call' }
  })
  assert.equal(invalid.status, 400)

  await createRule(state.tokens.ADMIN_A, {
    name: `${tag} New lead`,
    nameAr: `${tag} عميل جديد`,
    trigger: 'NEW_LEAD',
    conditionDays: 3,
    channel: 'NOTIFICATION',
    template: 'Call {{client_name}} within {{due_date}}',
    templateAr: 'اتصل بـ {{client_name}} قبل {{due_date}}',
    priority: 10
  })
  const staleRule = await createRule(state.tokens.ADMIN_A, {
    name: `${tag} No contact`,
    trigger: 'NO_CONTACT',
    conditionDays: 3,
    channel: 'EMAIL',
    template: 'Re-engage {{client_name}}'
  })
  const viewingRule = await createRule(state.tokens.ADMIN_A, {
    name: `${tag} Viewing`,
    trigger: 'VIEWING_NO_DEAL',
    conditionDays: 2,
    channel: 'WHATSAPP',
    template: 'Offer after viewing to {{client_name}}'
  })
  const dealRule = await createRule(state.tokens.ADMIN_A, {
    name: `${tag} Stalled deal`,
    trigger: 'DEAL_STALLED',
    conditionDays: 0,
    channel: 'NOTIFICATION',
    template: 'Follow up on {{deal_reference}}'
  })

  const rules = await api('GET', '/api/follow-ups/rules', { token: state.tokens.ADMIN_A })
  assert.equal(rules.status, 200)
  assert.equal(rules.data.data.length, 4)
  assert.equal(rules.data.data[0].trigger, 'NEW_LEAD')
  assert.equal(rules.data.data[0].labelAr, 'عميل محتمل جديد')

  const foreignPatch = await api('PATCH', `/api/follow-ups/rules/${staleRule.id}`, {
    token: state.tokens.ADMIN_B,
    body: { isActive: false }
  })
  assert.equal(foreignPatch.status, 404)

  const foreignList = await api('GET', '/api/follow-ups/rules', { token: state.tokens.ADMIN_B })
  assert.equal(foreignList.data.data.length, 0)
  assert.ok(dealRule.id && viewingRule.id)
})

test('Package 41: evaluation creates deduplicated, bilingual, tenant-owned tasks', async () => {
  const runAt = new Date().toISOString()
  const agentEvaluate = await api('POST', '/api/follow-ups/evaluate', {
    token: state.tokens.AGENT_A,
    body: { now: runAt }
  })
  assert.equal(agentEvaluate.status, 403)

  const evaluate = await api('POST', '/api/follow-ups/evaluate', {
    token: state.tokens.LEAD_A,
    body: { now: runAt }
  })
  assert.equal(evaluate.status, 200, JSON.stringify(evaluate.data))
  assert.equal(evaluate.data.data.evaluatedRules, 4)
  assert.equal(evaluate.data.data.created, 4)
  assert.equal(evaluate.data.data.skipped, 0)

  const again = await api('POST', '/api/follow-ups/evaluate', {
    token: state.tokens.ADMIN_A,
    body: { now: runAt }
  })
  assert.equal(again.status, 200)
  assert.equal(again.data.data.created, 0)
  assert.equal(again.data.data.skipped, 4)

  const tasks = await api('GET', '/api/follow-ups/tasks', { token: state.tokens.ADMIN_A })
  assert.equal(tasks.status, 200)
  assert.equal(tasks.data.data.length, 4)
  state.taskIds = tasks.data.data.map((task) => task.id)
  const newLeadTask = tasks.data.data.find((task) => task.rule.trigger === 'NEW_LEAD')
  assert.match(newLeadTask.title, /^Call /)
  assert.ok(newLeadTask.titleAr.includes('اتصل'))
  assert.equal(newLeadTask.lead.id, state.currentLeadId)
  assert.equal(newLeadTask.userId, state.agentA)
  const noContactTask = tasks.data.data.find((task) => task.rule.trigger === 'NO_CONTACT')
  assert.equal(noContactTask.lead.id, state.staleLeadId)
  const dealTask = tasks.data.data.find((task) => task.rule.trigger === 'DEAL_STALLED')
  assert.equal(dealTask.deal.id, state.dealId)
  const viewingTask = tasks.data.data.find((task) => task.rule.trigger === 'VIEWING_NO_DEAL')
  assert.equal(viewingTask.lead.id, state.currentLeadId)

  const agentTasks = await api('GET', '/api/follow-ups/tasks', { token: state.tokens.AGENT_A })
  assert.equal(agentTasks.data.data.length, 4)
  const otherAgentTasks = await api('GET', '/api/follow-ups/tasks', { token: state.tokens.AGENT_B })
  assert.equal(otherAgentTasks.data.data.length, 0)
  const summary = await api('GET', '/api/follow-ups/summary', { token: state.tokens.ADMIN_A })
  assert.equal(summary.data.data.rules, 4)
  assert.equal(summary.data.data.pending, 4)
  assert.equal(summary.data.data.completed, 0)

  const audit = await prisma.auditLog.count({ where: { action: 'FOLLOW_UP_AUTOMATION_RUN' } })
  assert.equal(audit, 1)
})

test('Package 41: task status changes are scoped and cannot be reopened', async () => {
  const taskId = state.taskIds[0]
  const foreignStatus = await api('PATCH', `/api/follow-ups/tasks/${taskId}/status`, {
    token: state.tokens.AGENT_B,
    body: { status: 'COMPLETED' }
  })
  assert.equal(foreignStatus.status, 404)

  const badStatus = await api('PATCH', `/api/follow-ups/tasks/${taskId}/status`, {
    token: state.tokens.AGENT_A,
    body: { status: 'ARCHIVED' }
  })
  assert.equal(badStatus.status, 400)

  const completed = await api('PATCH', `/api/follow-ups/tasks/${taskId}/status`, {
    token: state.tokens.AGENT_A,
    body: { status: 'COMPLETED', notes: 'Called the client' }
  })
  assert.equal(completed.status, 200, JSON.stringify(completed.data))
  assert.equal(completed.data.data.status, 'COMPLETED')
  assert.ok(completed.data.data.completedAt)

  const reopen = await api('PATCH', `/api/follow-ups/tasks/${taskId}/status`, {
    token: state.tokens.AGENT_A,
    body: { status: 'PENDING' }
  })
  assert.equal(reopen.status, 400)

  const summary = await api('GET', '/api/follow-ups/summary', { token: state.tokens.AGENT_A })
  assert.equal(summary.data.data.pending, 3)
  assert.equal(summary.data.data.completed, 1)
})

test('Package 41: additive schema, scheduler and bilingual UI are wired', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /enum FollowUpTrigger/)
  assert.match(schema, /model FollowUpRule/)
  assert.match(schema, /model FollowUpTask/)
  const migration = read('prisma/migrations/20261128000000_package41_42_followups_units/migration.sql')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS \"FollowUpRule\"/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS \"FollowUpTask\"/)
  const index = read('backend/index.ts')
  assert.match(index, /app\.use\('\/api\/follow-ups', followUpRoutes\)/)
  const reminders = read('backend/services/reminders.ts')
  assert.match(reminders, /runFollowUpAutomation/)
  const router = read('frontend/src/router/index.ts')
  assert.match(router, /path: 'follow-ups'/)
  const view = read('frontend/src/views/FollowUpAutomationView.vue')
  assert.match(view, /أتمتة المتابعة/)
  assert.match(view, /Follow-up automation/)
  assert.match(view, /triggerLabel/)
})
