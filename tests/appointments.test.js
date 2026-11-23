const test = require('node:test')
const assert = require('node:assert/strict')

const {
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  appointmentScope,
  appointmentWindow,
  assertValidAppointmentWindow,
  findAppointmentConflicts,
  appointmentConflictWarnings
} = require('../dist-backend/utils/appointments.js')
const { ValidationError } = require('../dist-backend/utils/validation.js')

const start = new Date('2026-01-10T10:00:00.000Z')
const end = new Date('2026-01-10T11:00:00.000Z')

function fakeClient(candidates) {
  return {
    appointment: {
      findMany: async () => candidates
    }
  }
}

function candidate(overrides = {}) {
  return {
    id: 'other',
    title: 'Viewing',
    startsAt: new Date('2026-01-10T10:30:00.000Z'),
    endsAt: new Date('2026-01-10T11:30:00.000Z'),
    status: 'SCHEDULED',
    userId: 'agent-1',
    propertyId: 'property-1',
    ...overrides
  }
}

test('appointmentWindow defaults open-ended appointments to one hour', () => {
  const window = appointmentWindow(start, null)
  assert.equal(window.start, start)
  assert.equal(window.end.getTime() - start.getTime(), DEFAULT_APPOINTMENT_DURATION_MINUTES * 60 * 1000)
  assert.equal(appointmentWindow(start, end).end, end)
})

test('assertValidAppointmentWindow rejects non-positive windows on create and update', () => {
  assert.doesNotThrow(() => assertValidAppointmentWindow(start, end))
  assert.doesNotThrow(() => assertValidAppointmentWindow(start, null))
  assert.throws(() => assertValidAppointmentWindow(start, start), ValidationError)
  assert.throws(() => assertValidAppointmentWindow(start, new Date(start.getTime() - 1)), ValidationError)
})

test('appointmentScope requires a local organizer and local linked records', () => {
  const scope = appointmentScope('org-1')
  const org = 'org-1'
  assert.deepEqual(scope.AND, [
    { user: { organizationId: org } },
    { OR: [{ propertyId: null }, { property: { organizationId: org } }] },
    {
      OR: [
        { leadId: null },
        {
          lead: {
            AND: [
              { OR: [{ property: { organizationId: org } }, { assignedTo: { organizationId: org } }] },
              { OR: [{ propertyId: null }, { property: { organizationId: org } }] },
              { OR: [{ assignedToId: null }, { assignedTo: { organizationId: org } }] }
            ]
          }
        }
      ]
    }
  ])
})

test('findAppointmentConflicts reports overlapping user and property appointments only', async () => {
  const candidates = [
    candidate(),
    candidate({ id: 'future', startsAt: end, endsAt: new Date(end.getTime() + 60 * 60 * 1000) }),
    candidate({ id: 'cancelled', status: 'CANCELLED' }),
    candidate({ id: 'no-show', status: 'NO_SHOW' })
  ]
  const conflicts = await findAppointmentConflicts(fakeClient(candidates), {
    organizationId: 'org-1',
    startsAt: start,
    endsAt: end,
    userId: 'agent-1',
    propertyId: 'property-1'
  })
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].id, 'other')
  assert.deepEqual(conflicts[0].reasons, ['user', 'property'])
  assert.equal(conflicts[0].startsAt, '2026-01-10T10:30:00.000Z')
})

test('findAppointmentConflicts skips self and handles open-ended windows', async () => {
  const conflicts = await findAppointmentConflicts(fakeClient([
    candidate({ id: 'self', startsAt: new Date('2026-01-10T10:59:00.000Z'), endsAt: null })
  ]), {
    organizationId: 'org-1',
    startsAt: start,
    endsAt: end,
    userId: 'agent-1',
    excludeId: 'self'
  })
  assert.equal(conflicts.length, 0)

  const openEnded = await findAppointmentConflicts(fakeClient([
    candidate({ id: 'before', startsAt: new Date('2026-01-10T09:30:00.000Z'), endsAt: null })
  ]), {
    organizationId: 'org-1',
    startsAt: start,
    endsAt: end,
    propertyId: 'property-1'
  })
  assert.equal(openEnded.length, 1)
  assert.deepEqual(openEnded[0].reasons, ['property'])
})

test('conflict warnings are advisory and carry conflict details', async () => {
  const conflicts = await findAppointmentConflicts(fakeClient([candidate()]), {
    organizationId: 'org-1',
    startsAt: start,
    endsAt: end,
    userId: 'agent-1'
  })
  assert.deepEqual(appointmentConflictWarnings([]), [])
  const warnings = appointmentConflictWarnings(conflicts)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].code, 'APPOINTMENT_CONFLICT')
  assert.equal(warnings[0].conflicts.length, 1)
  assert.match(warnings[0].message, /overlapping appointment/)
})
