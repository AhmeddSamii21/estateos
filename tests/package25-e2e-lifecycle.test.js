const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const http = require('node:http')
const bcrypt = require('bcrypt')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.NODE_ENV = 'test'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'
process.env.WEBHOOK_ALLOW_PRIVATE_URLS = 'true'
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',')

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `E2E-${runId}`

const state = {
  orgId: null,
  users: {},
  passwords: {},
  tokens: {},
  ownerId: null,
  propertyId: null,
  attachmentId: null,
  share: null,
  leads: {},
  appointments: [],
  dealId: null,
  checklist: [],
  installmentIds: [],
  paymentIds: [],
  commissionId: null,
  maintenanceId: null,
  followUpId: null,
  payoutId: null,
  endpointId: null,
  webhookSecret: null,
  entityIds: [],
  receivedWebhooks: []
}

let baseUrl
let server
let receiver
let receiverUrl

function track(id) {
  if (id && !state.entityIds.includes(id)) state.entityIds.push(id)
  return id
}

function isoDays(offsetDays) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString()
}

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
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  const expected = options.expect === undefined
    ? (method === 'POST' ? [200, 201] : [200])
    : (Array.isArray(options.expect) ? options.expect : [options.expect])
  if (!expected.includes(response.status)) {
    const detail = data && typeof data === 'object' ? (data.error || data.message || data) : data
    throw new Error(`Expected ${expected.join('/')} from ${method} ${path}, got ${response.status}: ${JSON.stringify(detail)}`)
  }
  return { status: response.status, data, headers: response.headers }
}

async function apiText(method, path, options = {}) {
  const headers = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  const response = await fetch(`${baseUrl}${path}`, { method, headers })
  const body = await response.text()
  assert.equal(response.status, 200, `${method} ${path} should succeed`)
  return { body, headers: response.headers }
}

function dataOf(response) {
  assert.ok(response.data && typeof response.data === 'object', 'Response must contain a JSON body')
  return Object.prototype.hasOwnProperty.call(response.data, 'data') ? response.data.data : response.data
}

async function startReceiver() {
  receiver = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      state.receivedWebhooks.push({
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8')
      })
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{"ok":true}')
    })
  })
  receiver.listen(0, '127.0.0.1')
  await new Promise((resolve) => receiver.once('listening', resolve))
  receiverUrl = `http://127.0.0.1:${receiver.address().port}/hooks`
}

async function stopReceiver() {
  if (!receiver) return
  const current = receiver
  receiver = null
  await new Promise((resolve) => current.close(resolve))
}

async function createUser(key, role) {
  const password = `E2ePass!${crypto.randomBytes(12).toString('base64url')}`
  const user = await prisma.user.create({
    data: {
      email: `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`,
      password: await bcrypt.hash(password, 10),
      role,
      organizationId: state.orgId,
      firstName: `E2E ${key}`,
      isActive: true
    },
    select: { id: true, email: true, role: true }
  })
  state.users[key] = user
  state.passwords[key] = password
  track(user.id)
  return user
}

async function login(key) {
  const response = await api('POST', '/api/auth/login', {
    body: { email: state.users[key].email, password: state.passwords[key] }
  })
  state.tokens[key] = dataOf(response).token
  assert.ok(state.tokens[key], `${key} login should return a token`)
}

test.before(async () => {
  await startReceiver()
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const organization = await prisma.organization.create({
    data: {
      name: `${tag} Organization`,
      slug: `${tag.toLowerCase()}-org`,
      currency: 'USD',
      baseCurrency: 'USD'
    },
    select: { id: true }
  })
  state.orgId = organization.id
  track(organization.id)

  await createUser('ADMIN', 'ADMIN')
  await createUser('AGENT', 'AGENT')
  await createUser('ACCOUNTANT', 'ACCOUNTANT')
  for (const key of Object.keys(state.users)) await login(key)
})

test.after(async () => {
  try {
    if (state.orgId) {
      const userIds = Object.values(state.users).map((user) => user.id)
      if (userIds.length) {
        await prisma.webhookDelivery.deleteMany({ where: { organizationId: state.orgId } })
        await prisma.webhookEndpoint.deleteMany({ where: { organizationId: state.orgId } })
        await prisma.auditLog.deleteMany({
          where: {
            OR: [
              { userId: { in: userIds } },
              { entityId: { in: state.entityIds } }
            ]
          }
        })
        await prisma.notification.deleteMany({
          where: { OR: [{ organizationId: state.orgId }, { userId: { in: userIds } }] }
        })

        const expenseClauses = []
        if (state.propertyId) expenseClauses.push({ propertyId: state.propertyId })
        if (state.dealId) expenseClauses.push({ dealId: state.dealId })
        if (expenseClauses.length) await prisma.expense.deleteMany({ where: { OR: expenseClauses } })
        if (state.dealId) {
          await prisma.payment.deleteMany({ where: { dealId: state.dealId } })
          await prisma.commission.deleteMany({ where: { dealId: state.dealId } })
          await prisma.dealClosingChecklist.deleteMany({ where: { dealId: state.dealId } })
          await prisma.deal.deleteMany({ where: { id: state.dealId } })
        }
        if (state.propertyId) {
          await prisma.appointment.deleteMany({ where: { OR: [{ propertyId: state.propertyId }, { userId: { in: userIds } }] } })
          await prisma.lead.deleteMany({ where: { OR: [{ propertyId: state.propertyId }, { assignedToId: { in: userIds } }] } })
          await prisma.maintenanceRequest.deleteMany({ where: { propertyId: state.propertyId } })
          await prisma.propertyActivity.deleteMany({ where: { propertyId: state.propertyId } })
          await prisma.property.deleteMany({ where: { id: state.propertyId } })
        }
        if (state.ownerId) {
          await prisma.ownerPayout.deleteMany({ where: { ownerId: state.ownerId } })
          await prisma.owner.deleteMany({ where: { id: state.ownerId } })
        }
        await prisma.user.deleteMany({ where: { organizationId: state.orgId } })
      }
      await prisma.settings.deleteMany({ where: { organizationId: state.orgId } })
      await prisma.organization.deleteMany({ where: { id: state.orgId } })
    }
  } finally {
    await stopReceiver()
    await shutdown()
  }
})

test('Package 25: full bilingual lifecycle from owner to webhook delivery', async (t) => {
  const admin = state.tokens.ADMIN
  const agent = state.tokens.AGENT

  await t.test('owner and property share link are created and publicly readable', async () => {
    const ownerResponse = await api('POST', '/api/owners', {
      token: admin,
      body: {
        firstName: 'Lifecycle',
        lastName: 'Owner',
        email: `${tag.toLowerCase()}-owner@example.invalid`,
        phone: '+10000000001'
      }
    })
    const owner = dataOf(ownerResponse)
    assert.ok(owner.displayName)
    state.ownerId = track(owner.id)

    const endpointResponse = await api('POST', '/api/webhooks/endpoints', {
      token: admin,
      body: {
        url: receiverUrl,
        events: ['property.created', 'lead.created', 'deal.stage_changed', 'payment.recorded'],
        isActive: true
      }
    })
    const endpoint = dataOf(endpointResponse)
    state.endpointId = track(endpoint.id)
    state.webhookSecret = endpointResponse.data.secret
    assert.match(state.webhookSecret, /^whsec_/)
    assert.equal(endpointViewHasSecret(endpointResponse.data.data), false)

    const propertyResponse = await api('POST', '/api/properties', {
      token: admin,
      body: {
        ownerId: state.ownerId,
        assignedAgentId: state.users.AGENT.id,
        referenceNumber: `${tag}-PROP`,
        title: 'Lifecycle Apartment',
        description: 'Package 25 end-to-end property',
        type: 'APARTMENT',
        status: 'AVAILABLE',
        classification: 'SALE',
        city: 'Cairo',
        country: 'Egypt',
        address: '1 Lifecycle Street',
        price: 250000,
        currency: 'USD'
      }
    })
    const property = dataOf(propertyResponse)
    state.propertyId = track(property.id)

    const attachmentResponse = await api('POST', `/api/properties/${property.id}/attachments`, {
      token: admin,
      body: {
        kind: 'FLOORPLAN',
        name: 'Lifecycle floorplan',
        url: 'https://example.invalid/lifecycle-floorplan.pdf'
      }
    })
    state.attachmentId = track(dataOf(attachmentResponse).id)

    const shareResponse = await api('POST', `/api/properties/${property.id}/share-link`, {
      token: admin,
      body: { expiresAt: isoDays(7) }
    })
    state.share = dataOf(shareResponse)
    assert.equal(state.share.enabled, true)
    assert.ok(state.share.token)
    assert.ok(state.share.url.includes(state.share.token))

    const publicResponse = await api('GET', `/api/public/properties/${state.share.token}`)
    const publicProperty = dataOf(publicResponse)
    assert.equal(publicProperty.title, 'Lifecycle Apartment')
    assert.equal(publicProperty.referenceNumber, `${tag}-PROP`)
    assert.ok(Array.isArray(publicProperty.attachments))
    assert.ok(publicProperty.attachments.some((item) => item.id === state.attachmentId))

    const invalidShare = await api('GET', '/api/public/properties/not-a-real-token', { expect: 404 })
    assert.equal(invalidShare.data.success, false)
  })

  await t.test('lead priority is scored, recomputed and filterable', async () => {
    const hotResponse = await api('POST', '/api/leads', {
      token: agent,
      body: {
        firstName: 'Hot',
        lastName: 'Lead',
        email: `${tag.toLowerCase()}-hot@example.invalid`,
        phone: '+10000000002',
        status: 'NEW',
        source: 'Referral',
        budgetMin: 500000,
        budgetMax: 1000000,
        preferredType: 'APARTMENT',
        preferredCity: 'Cairo',
        propertyId: state.propertyId,
        assignedToId: state.users.AGENT.id,
        nextFollowUpAt: isoDays(1)
      }
    })
    const coldResponse = await api('POST', '/api/leads', {
      token: agent,
      body: {
        firstName: 'Cold',
        status: 'LOST',
        source: 'Unknown',
        assignedToId: state.users.AGENT.id
      }
    })
    const hot = dataOf(hotResponse)
    const cold = dataOf(coldResponse)
    state.leads.hot = hot
    state.leads.cold = cold
    track(hot.id)
    track(cold.id)

    assert.equal(hot.priorityTier, 'URGENT')
    assert.ok(hot.priorityScore >= 75)
    assert.equal(cold.priorityTier, 'LOW')
    assert.ok(hot.priorityScore > cold.priorityScore)

    await prisma.lead.update({
      where: { id: hot.id },
      data: { priorityScore: 1, priorityTier: 'LOW' }
    })
    const recomputed = dataOf(await api('POST', `/api/leads/${hot.id}/recompute-priority`, {
      token: admin,
      body: {}
    }))
    assert.equal(recomputed.priorityTier, 'URGENT')
    assert.ok(recomputed.priorityScore >= 75)

    const filtered = dataOf(await api('GET', '/api/leads?priority=URGENT&minPriorityScore=75&sort=priority_desc', {
      token: admin
    }))
    const ids = filtered.map((lead) => lead.id)
    assert.ok(ids.includes(hot.id))
    assert.ok(!ids.includes(cold.id))
  })

  await t.test('overlapping appointment returns an advisory conflict warning', async () => {
    const payload = {
      title: 'Lifecycle viewing',
      type: 'VIEWING',
      status: 'SCHEDULED',
      startsAt: isoDays(2),
      endsAt: new Date(Date.now() + 2 * 86_400_000 + 90 * 60_000).toISOString(),
      userId: state.users.AGENT.id,
      propertyId: state.propertyId,
      leadId: state.leads.hot.id
    }
    const first = await api('POST', '/api/appointments', { token: agent, body: payload })
    const second = await api('POST', '/api/appointments', { token: agent, body: { ...payload, title: 'Conflicting viewing' } })
    state.appointments.push(track(dataOf(first).id), track(dataOf(second).id))
    const warnings = second.data.warnings || []
    assert.ok(warnings.some((warning) => warning.code === 'APPOINTMENT_CONFLICT'))
  })

  await t.test('deal checklist, override and WON-equivalent completion are audited', async () => {
    const dealResponse = await api('POST', '/api/deals', {
      token: admin,
      body: {
        propertyId: state.propertyId,
        leadId: state.leads.hot.id,
        userId: state.users.AGENT.id,
        type: 'SALE',
        status: 'PENDING',
        amount: 250000,
        currency: 'USD',
        referenceNumber: `${tag}-DEAL`
      }
    })
    state.dealId = track(dataOf(dealResponse).id)

    const checklistResponse = await api('GET', `/api/deals/${state.dealId}/checklist`, { token: admin })
    const checklist = dataOf(checklistResponse)
    state.checklist = checklist.items || []
    assert.deepEqual(
      state.checklist.map((item) => item.itemKey).sort(),
      ['CONTRACT_SIGNED', 'DOCUMENTS_COMPLETE', 'HANDOVER_CONFIRMED', 'PAYMENT_SETTLED']
    )

    for (const item of state.checklist.slice(0, 3)) {
      await api('PATCH', `/api/deals/${state.dealId}/checklist/${item.itemKey}`, {
        token: admin,
        body: { completed: true }
      })
    }
    const partial = dataOf(await api('GET', `/api/deals/${state.dealId}/checklist`, { token: admin }))
    assert.equal(partial.completed, 3)
    assert.equal(partial.isComplete, false)

    const blocked = await api('PATCH', `/api/deals/${state.dealId}`, {
      token: admin,
      body: { status: 'ACTIVE' }
    })
    assert.equal(dataOf(blocked).status, 'ACTIVE')

    const incomplete = await api('PATCH', `/api/deals/${state.dealId}`, {
      token: admin,
      body: { status: 'COMPLETED' },
      expect: 400
    })
    assert.match(JSON.stringify(incomplete.data), /checklist/i)

    const completed = dataOf(await api('PATCH', `/api/deals/${state.dealId}`, {
      token: admin,
      body: {
        status: 'COMPLETED',
        checklistOverrideReason: 'Lifecycle package 25 documented override'
      }
    }))
    assert.equal(completed.status, 'COMPLETED')
    assert.ok(completed.closedAt)
    assert.match(completed.checklistOverrideReason, /Lifecycle package 25/)
  })

  await t.test('installments, payments and aging buckets are recorded', async () => {
    const scheduleResponse = await api('POST', `/api/deals/${state.dealId}/installments`, {
      token: admin,
      body: {
        downPayment: 25000,
        installmentCount: 3,
        frequency: 'MONTHLY',
        firstDueDate: isoDays(30),
        batchKey: `LIFE-${runId.replace(/[^A-Za-z0-9_-]/g, '')}`
      }
    })
    const schedule = dataOf(scheduleResponse)
    state.installmentIds = schedule.payments.map((payment) => payment.id)
    assert.equal(state.installmentIds.length, 3)

    const repeatResponse = await api('POST', `/api/deals/${state.dealId}/installments`, {
      token: admin,
      body: {
        downPayment: 25000,
        installmentCount: 3,
        frequency: 'MONTHLY',
        firstDueDate: isoDays(30),
        batchKey: schedule.batchKey
      }
    })
    assert.equal(repeatResponse.data.message, 'Installment schedule already exists')

    const paymentSpecs = [
      { status: 'PENDING', dueInDays: 10, amount: 1000 },
      { status: 'PENDING', dueInDays: -10, amount: 1000 },
      { status: 'PENDING', dueInDays: -45, amount: 1000 },
      { status: 'PENDING', dueInDays: -100, amount: 1000 },
      { status: 'COMPLETED', dueInDays: -5, amount: 1000 }
    ]
    for (const [index, spec] of paymentSpecs.entries()) {
      const body = {
        dealId: state.dealId,
        amount: spec.amount,
        currency: 'USD',
        status: spec.status,
        reference: `${tag}-PAY-${index}`,
        idempotencyKey: `${tag}-IDEM-${index}`,
        dueAt: isoDays(spec.dueInDays),
        ...(spec.status === 'COMPLETED' ? { paidAt: isoDays(-5) } : {})
      }
      const response = await api('POST', '/api/finance/payments', { token: admin, body })
      const payment = dataOf(response)
      state.paymentIds.push(track(payment.id))
      assert.ok(payment.aging && payment.aging.bucket)
    }

    const aging = dataOf(await api('GET', `/api/finance/payments/aging?dealId=${state.dealId}`, { token: admin }))
    assert.deepEqual(Object.keys(aging.summary).sort(), ['1_30_DAYS', '31_60_DAYS', '60_PLUS_DAYS', 'CURRENT', 'PAID'])
    assert.ok(aging.summary['1_30_DAYS'].count >= 1)
    assert.ok(aging.summary['31_60_DAYS'].count >= 1)
    assert.ok(aging.summary['60_PLUS_DAYS'].count >= 1)
    assert.ok(aging.summary.PAID.count >= 1)
  })

  await t.test('commission and statement are produced for the responsible agent', async () => {
    const commission = dataOf(await api('POST', '/api/finance/commissions', {
      token: admin,
      body: {
        dealId: state.dealId,
        userId: state.users.AGENT.id,
        rate: 0.05,
        currency: 'USD'
      }
    }))
    state.commissionId = track(commission.id)
    assert.equal(commission.status, 'PENDING')

    await api('PATCH', `/api/finance/commissions/${commission.id}`, {
      token: admin,
      body: { status: 'APPROVED' }
    })
    const paid = dataOf(await api('PATCH', `/api/finance/commissions/${commission.id}`, {
      token: admin,
      body: { status: 'PAID', paymentReference: `${tag}-COMMISSION` }
    }))
    assert.equal(paid.status, 'PAID')

    const statement = dataOf(await api('GET', `/api/finance/commission-statements?agentId=${state.users.AGENT.id}`, {
      token: admin
    }))
    assert.ok(Array.isArray(statement.lines))
    assert.ok(Array.isArray(statement.totals))
    assert.ok(statement.lines.some((line) => line.agentId === state.users.AGENT.id))
    assert.ok(statement.totals.some((total) => total.currency === 'USD'))
  })

  await t.test('recurring maintenance creates a linked expense and next cycle', async () => {
    const created = dataOf(await api('POST', '/api/maintenance', {
      token: admin,
      body: {
        propertyId: state.propertyId,
        assignedToId: state.users.AGENT.id,
        title: 'Lifecycle boiler service',
        priority: 'HIGH',
        cost: 150,
        currency: 'USD',
        dueAt: isoDays(7),
        recurrenceInterval: 'MONTHLY'
      }
    }))
    state.maintenanceId = track(created.id)
    assert.ok(created.nextDueAt)

    await api('PATCH', `/api/maintenance/${created.id}`, {
      token: admin,
      body: { status: 'IN_PROGRESS' }
    })
    const completed = dataOf(await api('PATCH', `/api/maintenance/${created.id}`, {
      token: admin,
      body: {
        status: 'COMPLETED',
        cost: 150,
        currency: 'USD',
        recordExpense: true,
        notes: 'Lifecycle maintenance completed'
      }
    }))
    assert.ok(completed.linkedExpenseId)
    state.followUpId = track(completed.recurringFollowUpId)
    assert.ok(state.followUpId)

    const expenses = dataOf(await api('GET', `/api/finance/expenses?propertyId=${state.propertyId}`, { token: admin }))
    assert.ok(expenses.some((expense) => expense.id === completed.linkedExpenseId))
  })

  await t.test('owner statement and payout settlement are available', async () => {
    const statement = dataOf(await api('GET', `/api/owners/${state.ownerId}/statement`, { token: admin }))
    assert.equal(statement.financialsRestricted, false)
    assert.ok(statement.properties.list.some((property) => property.id === state.propertyId))

    const payout = dataOf(await api('POST', `/api/owners/${state.ownerId}/payouts`, {
      token: admin,
      body: {
        amount: 5000,
        currency: 'USD',
        reference: `${tag}-PAYOUT`,
        periodStart: isoDays(-30),
        periodEnd: isoDays(0)
      }
    }))
    state.payoutId = track(payout.id)
    assert.equal(payout.status, 'PENDING')

    const settled = dataOf(await api('PATCH', `/api/owners/${state.ownerId}/payouts/${payout.id}`, {
      token: admin,
      body: { status: 'SETTLED' }
    }))
    assert.equal(settled.status, 'SETTLED')
    assert.ok(settled.settledAt)

    const payouts = await api('GET', `/api/owners/${state.ownerId}/payouts?status=SETTLED`, { token: admin })
    assert.ok(dataOf(payouts).some((row) => row.id === payout.id))
    assert.ok(payouts.data.summary.settled >= 1)
  })

  await t.test('audit activity filters and CSV export include lifecycle actions', async () => {
    const activity = await api('GET', '/api/activity?action=PROPERTY_CREATED&limit=50', { token: admin })
    assert.ok(dataOf(activity).some((entry) => entry.entityId === state.propertyId))

    const csv = await apiText('GET', '/api/activity/export?action=PROPERTY_CREATED', { token: admin })
    const text = csv.body.replace(/^\uFEFF/, '')
    assert.match(csv.headers.get('content-type'), /text\/csv/)
    assert.match(csv.headers.get('content-disposition'), /attachment/)
    const lines = text.split('\r\n')
    assert.match(lines[0], /^timestamp,action,entityType,entityId,entity,actorId,actorEmail,actorRole,metadata$/)
    assert.ok(lines.some((line) => line.includes('PROPERTY_CREATED') && line.includes(state.propertyId)))
  })

  await t.test('webhook deliveries are signed, logged and delivered to the local receiver', async () => {
    const deliveries = dataOf(await api('GET', '/api/webhooks/deliveries?limit=100', { token: admin }))
    const events = new Set(deliveries.map((delivery) => delivery.event))
    for (const event of ['property.created', 'lead.created', 'deal.stage_changed', 'payment.recorded']) {
      assert.ok(events.has(event), `${event} should have a delivery log`)
    }
    assert.ok(deliveries.every((delivery) => delivery.status === 'SUCCESS'), 'all local deliveries should succeed')
    assert.ok(deliveries.every((delivery) => delivery.responseStatus === 200))

    assert.ok(state.receivedWebhooks.length >= deliveries.length)
    const parsed = state.receivedWebhooks.map((entry) => ({
      ...entry,
      payload: JSON.parse(entry.body)
    }))
    for (const event of ['property.created', 'lead.created', 'deal.stage_changed', 'payment.recorded']) {
      assert.ok(parsed.some((entry) => entry.payload.event === event), `${event} should reach the receiver`)
    }

    const propertyWebhook = parsed.find((entry) => entry.payload.event === 'property.created')
    assert.equal(propertyWebhook.payload.organizationId, state.orgId)
    assert.equal(propertyWebhook.payload.data.entityId, state.propertyId)
    assert.match(propertyWebhook.headers['x-webhook-event'], /property\.created/)

    const delivery = deliveries.find((row) => row.event === 'property.created' && row.entityId === state.propertyId)
      || deliveries.find((row) => row.event === 'property.created')
    assert.ok(delivery)
    const received = parsed.find((entry) => entry.headers['x-webhook-delivery'] === delivery.id)
    assert.ok(received, 'receiver should see the matching delivery id')
    assert.equal(received.headers['x-webhook-signature'], signatureFor(received.body, state.webhookSecret))

    const secretLeak = JSON.stringify(propertyWebhook.payload)
    assert.ok(!secretLeak.includes('whsec_'))
    assert.ok(!secretLeak.includes('password'))
  })
})

function endpointViewHasSecret(view) {
  return Boolean(view && Object.prototype.hasOwnProperty.call(view, 'secret'))
}

function signatureFor(body, secret) {
  const secretHash = crypto.createHash('sha256').update(secret).digest('hex')
  const pepper = process.env.WEBHOOK_SIGNING_KEY || process.env.JWT_SECRET || 'estateos-webhook-development-key'
  const signingKey = crypto.createHmac('sha256', pepper).update(secretHash).digest()
  return `sha256=${crypto.createHmac('sha256', signingKey).update(body, 'utf8').digest('hex')}`
}
