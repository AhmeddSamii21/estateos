const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parseMoney,
  parseRate,
  convertToBase,
  sumMoney,
  receivedAmount,
  outstandingBalance,
  commissionAmount
} = require('../dist-backend/utils/money.js')
const { ValidationError } = require('../dist-backend/utils/validation.js')

test('parseMoney validates decimal precision and sign', () => {
  assert.equal(parseMoney('1250.50', 'amount', { required: true }), '1250.50')
  assert.equal(parseMoney(0, 'amount'), '0.00')
  assert.throws(() => parseMoney('1.234', 'amount'), ValidationError)
  assert.throws(() => parseMoney('-5', 'amount'), ValidationError)
  assert.throws(() => parseMoney('', 'amount', { required: true }), ValidationError)
  assert.throws(() => parseMoney('5', 'amount', { min: 10 }), ValidationError)
})

test('parseRate requires a positive finite rate', () => {
  assert.equal(parseRate('1.25'), '1.25000000')
  assert.equal(parseRate(undefined), undefined)
  assert.throws(() => parseRate('0'), ValidationError)
  assert.throws(() => parseRate('abc'), ValidationError)
})

test('convertToBase never recalculates same-currency transactions', () => {
  assert.deepEqual(convertToBase('100.00', 'USD', 'USD'), { baseAmount: '100.00', exchangeRate: '1.00000000' })
})

test('convertToBase requires and applies a supplied historical rate', () => {
  assert.deepEqual(convertToBase('100.00', 'EUR', 'USD', '1.2'), { baseAmount: '120.00', exchangeRate: '1.20000000' })
  assert.throws(() => convertToBase('100.00', 'EUR', 'USD'), ValidationError)
})

test('receivedAmount ignores pending, failed, refunded, and archived payments', () => {
  const received = receivedAmount([
    { amount: '40.00', status: 'COMPLETED' },
    { amount: '999.00', status: 'PENDING' },
    { amount: '10.00', status: 'COMPLETED', baseAmount: '12.00' },
    { amount: '50.00', status: 'COMPLETED', deletedAt: new Date() }
  ])
  assert.equal(received, '52.00')
})

test('outstandingBalance uses only received money and never goes negative', () => {
  assert.equal(outstandingBalance('250.00', [{ amount: '100.00', status: 'COMPLETED' }]), '150.00')
  assert.equal(outstandingBalance('250.00', [{ amount: '400.00', status: 'COMPLETED' }]), '0.00')
})

test('sumMoney uses decimal addition', () => {
  assert.equal(sumMoney(['0.10', '0.20', '12.70']), '13.00')
})

test('commissionAmount uses decimal math and preserves an 8-decimal rate', () => {
  assert.equal(commissionAmount('100.00', '0.02500000'), '2.50')
  assert.equal(commissionAmount('333.33', '0.07500000'), '25.00')
  assert.equal(commissionAmount('100.00', '0.00012345'), '0.01')
  assert.throws(() => commissionAmount('100.00', '0'), ValidationError)
})
