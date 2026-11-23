const test = require('node:test')
const assert = require('node:assert/strict')

const { validatePropertyTransition, PROPERTY_TRANSITIONS } = require('../dist-backend/utils/propertyStatus.js')

test('property status transitions allow valid lifecycle moves', () => {
  assert.doesNotThrow(() => validatePropertyTransition('AVAILABLE', 'UNDER_NEGOTIATION'))
  assert.doesNotThrow(() => validatePropertyTransition('PENDING', 'RESERVED'))
  assert.doesNotThrow(() => validatePropertyTransition('AVAILABLE', 'AVAILABLE'))
  assert.doesNotThrow(() => validatePropertyTransition('AVAILABLE', 'UNAVAILABLE'))
})

test('property status transitions reject invalid moves', () => {
  assert.throws(() => validatePropertyTransition('SOLD', 'AVAILABLE'), /Invalid property status transition/)
  assert.throws(() => validatePropertyTransition('CANCELLED', 'AVAILABLE'), /Invalid property status transition/)
})

test('terminal and new statuses are represented in the transition map', () => {
  assert.deepEqual(PROPERTY_TRANSITIONS.SOLD, [])
  assert.ok(PROPERTY_TRANSITIONS.UNDER_NEGOTIATION.includes('SOLD'))
  assert.ok(PROPERTY_TRANSITIONS.UNAVAILABLE.includes('AVAILABLE'))
})
