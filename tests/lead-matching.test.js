const test = require('node:test')
const assert = require('node:assert/strict')

const { scoreLeadPropertyMatch } = require('../dist-backend/utils/leadMatching.js')

test('lead matching scores strong matches higher and includes reasons', () => {
  const lead = {
    budgetMin: '100000',
    budgetMax: '200000',
    preferredType: 'APARTMENT',
    preferredCity: 'Cairo',
    preferredBedrooms: 2,
    preferredAreaMin: '80',
    preferredAreaMax: '120'
  }
  const good = {
    type: 'APARTMENT',
    city: 'New Cairo',
    state: null,
    country: 'Egypt',
    address: null,
    bedrooms: 2,
    area: '100',
    price: '150000'
  }
  const bad = {
    type: 'LAND',
    city: 'Alexandria',
    state: null,
    country: 'Egypt',
    address: null,
    bedrooms: 0,
    area: '500',
    price: '500000'
  }
  const goodScore = scoreLeadPropertyMatch(lead, good)
  const badScore = scoreLeadPropertyMatch(lead, bad)
  assert.ok(goodScore.score > badScore.score)
  assert.ok(goodScore.reasons.includes('Budget fit'))
  assert.ok(goodScore.reasons.includes('Property type match'))
  assert.ok(goodScore.reasons.includes('Location match'))
})

test('lead matching with no criteria still returns available-property fallback', () => {
  const score = scoreLeadPropertyMatch({
    budgetMin: null,
    budgetMax: null,
    preferredType: null,
    preferredCity: null,
    preferredBedrooms: null,
    preferredAreaMin: null,
    preferredAreaMax: null
  }, {
    type: 'HOUSE',
    city: 'Cairo',
    state: null,
    country: 'Egypt',
    address: null,
    bedrooms: 3,
    area: '120',
    price: '100000'
  })
  assert.equal(score.score, 1)
  assert.deepEqual(score.reasons, ['Available property'])
})
