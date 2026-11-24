const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_MONTH_STEPS,
  addMonthsClamped,
  calculatePaymentPlan,
  formatAmortizationMoney,
  formatAmortizationPercent,
  buildAmortizationSummaryText,
  buildAmortizationWhatsAppMessage
} = require('../frontend/src/utils/paymentCalculatorCore.mjs')
const { buildWhatsAppUrl } = require('../frontend/src/utils/whatsappCore.mjs')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const number = (value) => Number(String(value).replace(/,/g, ''))

test('Package 32: pure calculator clamps quarter ends and balances a zero-rate schedule', () => {
  assert.deepEqual([...INSTALLMENT_FREQUENCIES], ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'])
  assert.equal(INSTALLMENT_MONTH_STEPS.QUARTERLY, 3)
  assert.equal(addMonthsClamped(new Date('2026-01-31T00:00:00Z'), 3).toISOString(), '2026-04-30T00:00:00.000Z')

  const plan = calculatePaymentPlan({
    price: '3000',
    downPaymentPercent: 0,
    termYears: 1,
    termMonths: 0,
    frequency: 'QUARTERLY',
    firstDueDate: '2026-01-31',
    annualRatePercent: 0,
    currency: 'EGP'
  })

  assert.equal(plan.downPayment, '0.00')
  assert.equal(plan.financedAmount, '3000.00')
  assert.equal(plan.termMonths, 12)
  assert.equal(plan.periodCount, 4)
  assert.deepEqual(plan.rows.map((row) => row.dueAt), [
    '2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31'
  ])
  assert.deepEqual(plan.rows.map((row) => row.payment), ['750.00', '750.00', '750.00', '750.00'])
  assert.equal(plan.totalPaid, '3000.00')
  assert.equal(plan.remainingBalance, '0.00')
})

test('Package 32: years plus months and amount override drive the periodic payment', () => {
  const plan = calculatePaymentPlan({
    price: 12000,
    downPaymentPercent: 50,
    downPaymentAmount: 2000,
    termYears: 1,
    termMonths: 3,
    frequency: 'MONTHLY',
    firstDueDate: '2026-03-15',
    annualRatePercent: 0
  })

  assert.equal(plan.downPayment, '2000.00')
  assert.equal(plan.financedAmount, '10000.00')
  assert.equal(plan.termMonths, 15)
  assert.equal(plan.periodCount, 15)
  assert.equal(plan.periodicPayment, '666.66')
  assert.equal(plan.rows.length, 15)
  assert.equal(plan.rows.at(-1).dueAt, '2027-05-15')
  assert.equal(plan.rows.at(-1).payment, '666.76')
  assert.equal(plan.remainingBalance, '0.00')
  assert.equal(plan.totalPaid, '10000.00')
})

test('Package 32: amortized interest and flat markup both close the balance', () => {
  const amortized = calculatePaymentPlan({
    price: 100000,
    downPaymentPercent: 10,
    termYears: 1,
    frequency: 'MONTHLY',
    firstDueDate: '2026-01-15',
    annualRatePercent: 12,
    rateMode: 'AMORTIZED'
  })
  assert.equal(amortized.periodicPayment, '7996.39')
  assert.ok(Math.abs(number(amortized.totalInterest) - 5956.69) <= 1)
  assert.equal(amortized.remainingBalance, '0.00')

  const flat = calculatePaymentPlan({
    price: 12000,
    downPaymentAmount: 2000,
    termYears: 2,
    frequency: 'MONTHLY',
    firstDueDate: '2026-02-28',
    annualRatePercent: 10,
    rateMode: 'FLAT'
  })
  assert.equal(flat.totalInterest, '2000.00')
  assert.equal(flat.periodicPayment, '499.99')
  assert.equal(flat.rows.length, 24)
  assert.equal(flat.rows.at(-1).dueAt, '2028-01-28')
  assert.equal(flat.remainingBalance, '0.00')
  assert.equal(flat.totalPaid, '12000.00')
})

test('Package 32: fixed and percentage balloons are added without breaking the schedule', () => {
  const plan = calculatePaymentPlan({
    price: 10000,
    downPaymentAmount: 1000,
    termYears: 1,
    frequency: 'MONTHLY',
    firstDueDate: '2026-01-01',
    annualRatePercent: 0,
    balloons: [
      { month: 6, amount: 500 },
      { month: 12, percent: 10 }
    ]
  })

  assert.deepEqual(plan.balloons, [
    { month: 6, amount: '500.00' },
    { month: 12, amount: '900.00' }
  ])
  assert.equal(plan.rows[5].balloon, '500.00')
  assert.equal(plan.rows[5].balance, '4700.02')
  assert.equal(plan.rows.at(-1).payment, '633.37')
  assert.equal(plan.rows.at(-1).balloon, '900.00')
  assert.equal(plan.totalBalloons, '1400.00')
  assert.equal(plan.totalPaid, '9000.00')
  assert.equal(plan.remainingBalance, '0.00')
})

test('Package 32: unsafe calculator input is rejected instead of producing a misleading plan', () => {
  const base = {
    price: 1000,
    downPaymentPercent: 10,
    termYears: 1,
    frequency: 'MONTHLY',
    firstDueDate: '2026-01-01',
    annualRatePercent: 0
  }
  assert.throws(() => calculatePaymentPlan({ ...base, price: -1 }), /price/)
  assert.throws(() => calculatePaymentPlan({ ...base, downPaymentPercent: 101 }), /downPaymentPercent/)
  assert.throws(() => calculatePaymentPlan({ ...base, downPaymentAmount: 2000 }), /downPayment/)
  assert.throws(() => calculatePaymentPlan({ ...base, termYears: 0, termMonths: 0 }), /term/)
  assert.throws(() => calculatePaymentPlan({ ...base, firstDueDate: '2026-02-30' }), /firstDueDate/)
  assert.throws(() => calculatePaymentPlan({ ...base, frequency: 'WEEKLY' }), /frequency/)
  assert.throws(() => calculatePaymentPlan({ ...base, balloons: [{ month: 1, percent: 101 }] }), /balloons\[0\]\.percent/)
  assert.throws(() => calculatePaymentPlan({ ...base, balloons: [{ month: 1, amount: 2000 }] }), /balloons/)
})

test('Package 32: EN/AR summaries are formatted for print and WhatsApp', () => {
  const input = {
    price: 10000,
    downPaymentPercent: 20,
    termYears: 1,
    frequency: 'QUARTERLY',
    firstDueDate: '2026-01-31',
    annualRatePercent: 5,
    rateMode: 'FLAT',
    currency: 'EGP'
  }
  const english = calculatePaymentPlan({ ...input, language: 'en' })
  const arabic = calculatePaymentPlan({ ...input, language: 'ar' })

  assert.equal(english.language, 'en')
  assert.equal(arabic.language, 'ar')
  assert.match(buildAmortizationSummaryText(english), /Property price/)
  assert.match(buildAmortizationSummaryText(arabic), /سعر العقار/)
  assert.match(buildAmortizationSummaryText(arabic), /تاريخ الاستحقاق/)
  assert.match(formatAmortizationPercent('12.5', 'ar'), /12[.,٫]5%/)
  assert.match(formatAmortizationMoney('1234.5', 'EGP', 'en'), /1,234\.50/)
  assert.match(formatAmortizationMoney('1234.5', 'EGP', 'ar'), /1,234\.50/)

  const message = buildAmortizationWhatsAppMessage(english, 'en', 'EGP')
  const url = buildWhatsAppUrl('01000000000', message)
  assert.match(url, /^https:\/\/wa\.me\/201000000000\?text=/)
  assert.equal(new URL(url).searchParams.get('text'), message)
  assert.match(new URL(url).searchParams.get('text'), /EstateOS payment plan/)
})

test('Package 32: calculator core, typed wrapper, view, and navigation are wired', () => {
  const core = read('frontend/src/utils/paymentCalculatorCore.mjs')
  const declarations = read('frontend/src/utils/paymentCalculatorCore.d.mts')
  const wrapper = read('frontend/src/utils/paymentCalculator.ts')
  const view = read('frontend/src/views/PaymentCalculatorView.vue')
  const router = read('frontend/src/router/index.ts')
  const layout = read('frontend/src/components/Layout.vue')
  const palette = read('frontend/src/components/CommandPalette.vue')

  assert.match(core, /export function calculatePaymentPlan/)
  assert.match(core, /export function buildAmortizationWhatsAppMessage/)
  assert.equal(/require\(|from ['"]vue['"]|prisma\./.test(core), false)
  assert.match(declarations, /interface PaymentPlanInput/)
  assert.match(declarations, /interface PaymentPlan/)
  assert.match(wrapper, /openAmortizationWhatsApp/)
  assert.match(wrapper, /buildWhatsAppUrl/)
  assert.match(view, /store\.isArabic/)
  assert.match(view, /حاسبة الدفعات والتمويل/)
  assert.match(view, /Payment & mortgage calculator/)
  assert.match(view, /@media print/)
  assert.match(view, /window\.print\(\)/)
  assert.match(view, /openAmortizationWhatsApp/)
  assert.match(view, /buildAmortizationSummaryText/)
  assert.match(view, /INSTALLMENT_FREQUENCIES/)
  assert.match(router, /path: 'finance\/payment-calculator'/)
  assert.match(layout, /to="\/finance\/payment-calculator"/)
  assert.match(layout, /'Payment calculator': 'حاسبة الدفعات'/)
  assert.match(palette, /id: 'payment-calculator'/)
})
