const test = require('node:test')
const assert = require('node:assert/strict')

const {
  requiredString,
  optionalString,
  numberValue,
  enumValue,
  dateValue,
  booleanValue,
  pagination,
  ValidationError
} = require('../dist-backend/utils/validation.js')

test('requiredString trims and rejects empty or oversized values', () => {
  assert.equal(requiredString('  title  ', 'title'), 'title')
  assert.throws(() => requiredString('   ', 'title'), ValidationError)
  assert.throws(() => requiredString(42, 'title'), ValidationError)
  assert.throws(() => requiredString('x'.repeat(201), 'title', 200), ValidationError)
})

test('optionalString treats blank input as absent', () => {
  assert.equal(optionalString('', 'city'), undefined)
  assert.equal(optionalString(null, 'city'), undefined)
  assert.equal(optionalString(' Cairo ', 'city'), 'Cairo')
  assert.throws(() => optionalString(7, 'city'), ValidationError)
})

test('numberValue validates ranges and required numeric input', () => {
  assert.equal(numberValue('12.5', 'price'), 12.5)
  assert.equal(numberValue('', 'price'), undefined)
  assert.throws(() => numberValue('', 'price', { required: true }), ValidationError)
  assert.throws(() => numberValue('abc', 'price'), ValidationError)
  assert.throws(() => numberValue('5', 'price', { min: 10 }), ValidationError)
  assert.throws(() => numberValue('11', 'price', { max: 10 }), ValidationError)
})

test('enumValue restricts values and supports defaults', () => {
  assert.equal(enumValue('SOLD', 'status', ['NEW', 'SOLD']), 'SOLD')
  assert.equal(enumValue('', 'status', ['NEW', 'SOLD'], 'NEW'), 'NEW')
  assert.throws(() => enumValue('OTHER', 'status', ['NEW', 'SOLD']), ValidationError)
})

test('dateValue and booleanValue parse input safely', () => {
  assert.equal(dateValue('', 'startsAt'), undefined)
  assert.throws(() => dateValue('not-a-date', 'startsAt'), ValidationError)
  assert.equal(dateValue('2026-01-01', 'startsAt').getUTCFullYear(), 2026)
  assert.equal(booleanValue('true', 'featured'), true)
  assert.equal(booleanValue('false', 'featured'), false)
  assert.equal(booleanValue(undefined, 'featured', true), true)
  assert.throws(() => booleanValue('maybe', 'featured'), ValidationError)
})

test('pagination clamps page and limit', () => {
  assert.deepEqual(pagination({}), { page: 1, limit: 20, skip: 0 })
  assert.deepEqual(pagination({ page: '3', limit: '10' }), { page: 3, limit: 10, skip: 20 })
  assert.equal(pagination({ limit: '1000' }).limit, 100)
  assert.throws(() => pagination({ page: '0' }), ValidationError)
})
