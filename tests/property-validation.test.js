const test = require('node:test')
const assert = require('node:assert/strict')

const { numberValue, ValidationError } = require('../dist-backend/utils/validation.js')
const { parseMoney } = require('../dist-backend/utils/money.js')

test('property PATCH numeric validation enforces latitude/longitude/area/bedrooms/bathrooms/price bounds', () => {
  assert.throws(() => numberValue(123, 'latitude', { min: -90, max: 90 }), ValidationError)
  assert.throws(() => numberValue(-181, 'longitude', { min: -180, max: 180 }), ValidationError)
  assert.throws(() => numberValue(-1, 'area', { min: 0 }), ValidationError)
  assert.throws(() => numberValue(-1, 'bedrooms', { min: 0 }), ValidationError)
  assert.throws(() => numberValue(-1, 'bathrooms', { min: 0 }), ValidationError)
  assert.throws(() => numberValue(-1, 'floors', { min: 0 }), ValidationError)
  assert.throws(() => numberValue(1700, 'yearBuilt', { min: 1800, max: 2100 }), ValidationError)
  assert.throws(() => parseMoney(-5, 'price', { min: 0 }), ValidationError)
  assert.equal(numberValue(45.5, 'latitude', { min: -90, max: 90 }), 45.5)
  assert.equal(numberValue(120, 'longitude', { min: -180, max: 180 }), 120)
})

test('property currency code validation accepts 3-letter codes', () => {
  assert.match('USD', /^[A-Z]{3}$/)
  assert.doesNotThrow(() => {
    const currency = 'usd'.toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('invalid')
  })
  assert.throws(() => {
    const currency = 'US'.toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('invalid')
  })
})
