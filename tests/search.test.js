const test = require('node:test')
const assert = require('node:assert/strict')

const { buildPropertySearch } = require('../dist-backend/utils/search.js')

test('property search accepts the search alias used by the list UI', () => {
  const { where } = buildPropertySearch({ search: 'Riyadh tower' }, 'org-1')
  assert.equal(where.organizationId, 'org-1')
  assert.equal(where.isActive, true)
  assert.equal(where.deletedAt, null)
  assert.ok(Array.isArray(where.OR))
  assert.ok(where.OR.some((clause) => clause.title && clause.title.contains === 'Riyadh tower'))
})

test('property search validates and applies numeric filters', () => {
  const { where, orderBy } = buildPropertySearch({
    minPrice: '100000.00',
    maxPrice: '250000.00',
    bedrooms: '3',
    minArea: '120',
    minLatitude: '24.5',
    maxLatitude: '25.5',
    minLongitude: '46.4',
    maxLongitude: '46.9',
    sort: 'price_asc'
  }, 'org-1')
  assert.equal(where.price.gte, '100000.00')
  assert.equal(where.price.lte, '250000.00')
  assert.equal(where.bedrooms.gte, 3)
  assert.equal(where.area.gte, 120)
  assert.equal(where.latitude.gte, 24.5)
  assert.equal(where.longitude.lte, 46.9)
  assert.deepEqual(orderBy, { price: 'asc' })
})

test('property search rejects invalid availability and price values', () => {
  assert.throws(() => buildPropertySearch({ availability: 'maybe' }, 'org-1'))
  assert.throws(() => buildPropertySearch({ minPrice: '1.234' }, 'org-1'))
})
