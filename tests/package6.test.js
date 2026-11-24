const test = require('node:test')
const assert = require('node:assert/strict')

process.env.NODE_ENV = 'test'

const { Prisma, CommissionStatus, Role } = require('@prisma/client')

const followUps = require('../dist-backend/utils/followUps.js')
const leases = require('../dist-backend/utils/leases.js')
const statements = require('../dist-backend/utils/commissionStatements.js')

const NOW = new Date('2026-06-01T10:00:00.000Z')
const dec = (value) => new Prisma.Decimal(value)

test('Part 1: follow-up buckets use UTC calendar days', () => {
  assert.equal(followUps.followUpBucket(null, NOW), null)
  assert.equal(followUps.followUpBucket('2026-05-31T23:59:00.000Z', NOW), 'overdue')
  assert.equal(followUps.followUpBucket('2026-06-01T00:01:00.000Z', NOW), 'today')
  assert.equal(followUps.followUpBucket('2026-06-01T23:59:00.000Z', NOW), 'today')
  assert.equal(followUps.followUpBucket('2026-06-02T00:00:00.000Z', NOW), 'upcoming')
})

test('Part 1: follow-up filters map to exclusive date windows', () => {
  assert.deepEqual(followUps.followUpWhere('overdue', NOW), {
    nextFollowUpAt: { lt: new Date('2026-06-01T00:00:00.000Z') }
  })
  assert.deepEqual(followUps.followUpWhere('today', NOW), {
    nextFollowUpAt: {
      gte: new Date('2026-06-01T00:00:00.000Z'),
      lt: new Date('2026-06-02T00:00:00.000Z')
    }
  })
  assert.deepEqual(followUps.followUpWhere('upcoming', NOW), {
    nextFollowUpAt: { gte: new Date('2026-06-02T00:00:00.000Z') }
  })
})

test('Part 1: nullable follow-up dates accept null and reject invalid dates', () => {
  assert.equal(followUps.nullableDateValue(null, 'nextFollowUpAt'), null)
  assert.equal(followUps.nullableDateValue('', 'nextFollowUpAt'), null)
  assert.equal(followUps.nullableDateValue(undefined, 'nextFollowUpAt'), undefined)
  assert.equal(followUps.nullableDateValue('2026-06-02', 'nextFollowUpAt').toISOString(), '2026-06-02T00:00:00.000Z')
  assert.throws(() => followUps.nullableDateValue('not-a-date', 'nextFollowUpAt'))
})

test('Part 3: lease windows validate only when complete', () => {
  assert.doesNotThrow(() => leases.assertValidLease({
    leaseStartAt: new Date('2026-01-01T00:00:00.000Z'),
    leaseEndAt: new Date('2026-12-31T00:00:00.000Z')
  }))
  assert.doesNotThrow(() => leases.assertValidLease({ leaseEndAt: new Date('2026-12-31T00:00:00.000Z') }))
  assert.doesNotThrow(() => leases.assertValidLease({ leaseStartAt: new Date('2026-01-01T00:00:00.000Z') }))
  assert.throws(
    () => leases.assertValidLease({
      leaseStartAt: new Date('2026-06-01T00:00:00.000Z'),
      leaseEndAt: new Date('2026-06-01T00:00:00.000Z')
    }),
    /leaseEndAt must be after leaseStartAt/
  )
  assert.throws(
    () => leases.assertValidLease({
      leaseStartAt: new Date('2026-06-02T00:00:00.000Z'),
      leaseEndAt: new Date('2026-06-01T00:00:00.000Z')
    }),
    /leaseEndAt must be after leaseStartAt/
  )
  assert.throws(() => leases.assertValidLease({ renewalNoticeDays: 366 }))
  assert.throws(() => leases.assertValidLease({ renewalNoticeDays: 1.5 }), /must be an integer/)
})

test('Part 3: renewal state mirrors notice windows and sale deals are ignored', () => {
  assert.equal(leases.daysUntilLeaseEnd('2026-06-10T00:00:00.000Z', NOW), 9)
  assert.equal(leases.leaseRenewalState({ leaseEndAt: '2026-05-31T00:00:00.000Z' }, NOW), 'expired')
  assert.equal(leases.leaseRenewalState({ leaseEndAt: '2026-06-10T00:00:00.000Z', renewalNoticeDays: 30 }, NOW), 'due')
  assert.equal(leases.leaseRenewalState({ leaseEndAt: '2026-06-10T00:00:00.000Z', renewalNoticeDays: 5 }, NOW), 'upcoming')
  assert.equal(leases.leaseRenewalState({ leaseEndAt: '2026-06-10T00:00:00.000Z', type: 'SALE' }, NOW), null)
  assert.equal(leases.leaseRenewalState({ leaseEndAt: null }, NOW), null)
  assert.equal(leases.isLeaseRenewalDue({ leaseEndAt: '2026-05-31T00:00:00.000Z' }, NOW), true)
  assert.equal(leases.isLeaseRenewalDue({ leaseEndAt: '2026-06-10T00:00:00.000Z', renewalNoticeDays: 5 }, NOW), false)
})

test('Part 2: agents are scoped to their own commissions and cannot override the agent filter', () => {
  const own = statements.commissionStatementScope(Role.AGENT, 'agent-1', 'org-1')
  assert.deepEqual(own.OR, [
    { userId: 'agent-1' },
    { userId: null, deal: { userId: 'agent-1' } }
  ])
  assert.equal(own.deal.organizationId, 'org-1')
  assert.deepEqual(own.status.in, [
    CommissionStatus.PENDING,
    CommissionStatus.APPROVED,
    CommissionStatus.PAID
  ])
  assert.throws(
    () => statements.commissionStatementScope(Role.AGENT, 'agent-1', 'org-1', 'agent-2'),
    /own commission statement/
  )
})

test('Part 2: managers can view all agents or filter by agent', () => {
  const all = statements.commissionStatementScope(Role.MANAGER, 'manager-1', 'org-1')
  assert.equal(all.OR, undefined)
  assert.equal(all.deal.organizationId, 'org-1')
  const filtered = statements.commissionStatementScope(Role.ACCOUNTANT, 'acc-1', 'org-1', 'agent-2')
  assert.deepEqual(filtered.OR, [
    { userId: 'agent-2' },
    { userId: null, deal: { userId: 'agent-2' } }
  ])
})

test('Part 2: statements group by agent/status/currency and exclude cancelled rows', () => {
  const row = (id, userId, amount, status, currency, baseAmount = null, dealUser = null) => ({
    id,
    userId,
    amount: dec(amount),
    baseAmount: baseAmount === null ? null : dec(baseAmount),
    currency,
    status,
    deal: {
      id: `deal-${id}`,
      referenceNumber: `REF-${id}`,
      userId: dealUser || userId,
      user: dealUser ? { id: dealUser, email: `${dealUser}@example.test`, firstName: null } : null
    },
    user: userId ? { id: userId, email: `${userId}@example.test`, firstName: userId === 'agent-1' ? 'Alice' : null } : null
  })

  const report = statements.buildCommissionStatement([
    row('1', 'agent-1', '100.00', CommissionStatus.PENDING, 'USD', '100.00'),
    row('2', 'agent-1', '50.00', CommissionStatus.PENDING, 'USD', '50.00'),
    row('3', 'agent-1', '90.00', CommissionStatus.APPROVED, 'EUR', '108.00'),
    row('4', 'agent-2', '200.00', CommissionStatus.PAID, 'USD', '200.00'),
    row('5', 'agent-2', '500.00', CommissionStatus.CANCELLED, 'USD')
  ])

  assert.equal(report.lines.length, 3)
  const pending = report.lines.find((line) => line.agentId === 'agent-1' && line.status === CommissionStatus.PENDING)
  assert.deepEqual(pending, {
    agentId: 'agent-1',
    agentName: 'Alice',
    status: CommissionStatus.PENDING,
    currency: 'USD',
    count: 2,
    amount: '150.00',
    baseAmount: '150.00'
  })
  assert.equal(report.lines.some((line) => line.status === CommissionStatus.CANCELLED), false)
  assert.deepEqual(report.fxRows, [
    { currency: 'EUR', amount: '90.00' },
    { currency: 'USD', amount: '350.00' }
  ])
  assert.deepEqual(report.totals.find((total) => total.status === CommissionStatus.PAID), {
    status: CommissionStatus.PAID,
    currency: 'USD',
    count: 1,
    amount: '200.00'
  })
})

test('Part 2: legacy commissions without userId fall back to the deal agent', () => {
  const row = {
    id: 'legacy-1',
    userId: null,
    amount: dec('75.00'),
    baseAmount: null,
    currency: 'USD',
    status: CommissionStatus.APPROVED,
    deal: {
      id: 'deal-legacy',
      userId: 'agent-3',
      user: { id: 'agent-3', email: 'agent3@example.test', firstName: 'Carol' }
    }
  }
  assert.deepEqual(statements.agentIdentity(row), { id: 'agent-3', label: 'Carol' })
  const report = statements.buildCommissionStatement([row])
  assert.equal(report.lines[0].agentId, 'agent-3')
  assert.equal(report.lines[0].baseAmount, null)
})

// --- DB-backed reminder test with an in-memory prisma stub -----------------
const prismaModulePath = require.resolve('../dist-backend/prisma.js')
const stored = []
const calls = { createMany: 0 }

const fakePrisma = {
  organization: { findMany: async () => [{ id: 'org' }] },
  payment: { findMany: async () => [] },
  appointment: { findMany: async () => [] },
  // Package 18 added recurring-maintenance reminders; this stub has no cycles.
  maintenanceRequest: { findMany: async () => [] },
  user: { findMany: async () => [{ id: 'manager' }] },
  lead: {
    findMany: async () => [
      {
        id: 'lead-overdue',
        firstName: 'Over',
        lastName: 'Due',
        assignedToId: 'agent',
        nextFollowUpAt: new Date('2026-05-30T10:00:00.000Z')
      },
      {
        id: 'lead-today',
        firstName: 'Due',
        lastName: 'Today',
        assignedToId: 'agent',
        nextFollowUpAt: new Date('2026-06-01T09:00:00.000Z')
      },
      {
        id: 'lead-future',
        firstName: 'Future',
        lastName: 'Lead',
        assignedToId: 'agent',
        nextFollowUpAt: new Date('2026-06-20T09:00:00.000Z')
      }
    ]
  },
  deal: {
    findMany: async () => [
      {
        id: 'lease-due',
        referenceNumber: 'LEASE-DUE',
        userId: 'agent',
        type: 'RENT',
        leaseEndAt: new Date('2026-06-10T00:00:00.000Z'),
        renewalNoticeDays: 30,
        property: { title: 'Flat 1' }
      },
      {
        id: 'lease-expired',
        referenceNumber: 'LEASE-OLD',
        userId: 'agent',
        type: 'RENT',
        leaseEndAt: new Date('2026-05-01T00:00:00.000Z'),
        renewalNoticeDays: 30,
        property: { title: 'Flat 2' }
      },
      {
        id: 'lease-future',
        referenceNumber: 'LEASE-FUTURE',
        userId: 'agent',
        type: 'RENT',
        leaseEndAt: new Date('2026-12-01T00:00:00.000Z'),
        renewalNoticeDays: 30,
        property: { title: 'Flat 3' }
      }
    ]
  },
  notification: {
    findFirst: async ({ where }) => stored.find((row) =>
      row.userId === where.userId &&
      row.type === where.type &&
      row.entityId === where.entityId &&
      String(row.metadata?.reminderDay) === where.metadata.equals
    ) || null,
    findMany: async () => [],
    createMany: async ({ data }) => {
      calls.createMany += 1
      stored.push(...data.map((row) => ({ ...row, metadata: row.metadata || {} })))
      return { count: data.length }
    }
  }
}

require.cache[prismaModulePath] = {
  id: prismaModulePath,
  filename: prismaModulePath,
  loaded: true,
  exports: { prisma: fakePrisma }
}

const reminders = require('../dist-backend/services/reminders.js')

test('Part 1 & 3: lead and lease reminders are created once per day and deduplicated', async () => {
  const first = await reminders.runReminders(NOW, { organizationIds: ['org'] })
  assert.equal(first.organizations, 1)
  assert.equal(first.paymentReminders, 0)
  assert.equal(first.appointmentReminders, 0)
  // 2 leads x 2 recipients (agent + manager)
  assert.equal(first.leadFollowUpReminders, 4)
  // 2 leases x 2 recipients (agent + manager); future lease excluded
  assert.equal(first.leaseRenewalReminders, 4)

  const types = stored.map((row) => row.type)
  assert.equal(types.filter((type) => type === 'LEAD_FOLLOW_UP_OVERDUE_REMINDER').length, 2)
  assert.equal(types.filter((type) => type === 'LEAD_FOLLOW_UP_DUE_REMINDER').length, 2)
  assert.equal(types.filter((type) => type === 'LEASE_RENEWAL_REMINDER').length, 2)
  assert.equal(types.filter((type) => type === 'LEASE_EXPIRED_REMINDER').length, 2)
  assert.equal(stored.some((row) => row.entityId === 'lead-future'), false)
  assert.equal(stored.some((row) => row.entityId === 'lease-future'), false)

  const storedAfterFirst = stored.length
  const second = await reminders.runReminders(NOW, { organizationIds: ['org'] })
  assert.equal(second.leadFollowUpReminders, 0)
  assert.equal(second.leaseRenewalReminders, 0)
  assert.equal(stored.length, storedAfterFirst)
  assert.equal(calls.createMany, 8)

  const actions = new Set(stored.map((row) => row.actionUrl))
  assert.ok(actions.has('/leads?followUp=overdue'))
  assert.ok(actions.has('/leads?followUp=today'))
  assert.ok(actions.has('/deals/lease-due'))
})
