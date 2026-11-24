/**
 * EstateOS Package 32 — pure bilingual payment / mortgage calculator core.
 *
 * No DOM, Vue, Axios, Prisma, or Node APIs live here. The same module is used
 * by the Vite frontend and by `node --test` (which can require .mjs directly).
 */

export const INSTALLMENT_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL']

export const INSTALLMENT_MONTH_STEPS = Object.freeze({
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12
})

/** Returns the same UTC time on a later month, clamping to that month's last day. */
export function addMonthsClamped(date, months) {
  const day = date.getUTCDate()
  const result = new Date(date.getTime())
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

function fail(field, message) {
  throw new Error(`${field}: ${message}`)
}

function toCents(value, field) {
  if (value === undefined || value === null || value === '') fail(field, 'is required')
  const raw = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim())
  if (!Number.isFinite(raw) || raw < 0) fail(field, 'must be a non-negative number')
  const cents = Math.round(raw * 100)
  if (Math.abs(raw * 100 - cents) > 0.000001) fail(field, 'must have at most 2 decimal places')
  return cents
}

function toMoney(cents) {
  return (cents / 100).toFixed(2)
}

function toInteger(value, field, min, max) {
  if (value === undefined || value === null || value === '') fail(field, 'is required')
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    fail(field, `must be an integer between ${min} and ${max}`)
  }
  return numeric
}

function toPercent(value, field, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    fail(field, 'must be a percentage between 0 and 100')
  }
  return numeric
}

function parseDueDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail('firstDueDate', 'must be a valid YYYY-MM-DD date')
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail('firstDueDate', 'must be a valid calendar date')
  }
  return value
}

function parseBalloons(value, financedCents, termMonths) {
  if (value === undefined || value === null || value === '') return []
  if (!Array.isArray(value)) fail('balloons', 'must be an array')
  const seen = new Set()
  let total = 0
  const balloons = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') fail(`balloons[${index}]`, 'must be an object')
    const month = toInteger(entry.month, `balloons[${index}].month`, 1, termMonths)
    if (seen.has(month)) fail(`balloons[${index}].month`, 'must be unique')
    seen.add(month)

    let amountCents
    if (entry.amount !== undefined && entry.amount !== null && entry.amount !== '') {
      amountCents = toCents(entry.amount, `balloons[${index}].amount`)
    } else if (entry.percent !== undefined && entry.percent !== null && entry.percent !== '') {
      const percent = toPercent(entry.percent, `balloons[${index}].percent`, 0)
      amountCents = Math.round((financedCents * percent) / 100)
    } else {
      fail(`balloons[${index}]`, 'must provide amount or percent')
    }
    if (amountCents <= 0) fail(`balloons[${index}].amount`, 'must be greater than zero')
    total += amountCents
    return { month, amountCents }
  })
  if (total > financedCents) fail('balloons', 'total balloon amount cannot exceed the financed amount')
  return balloons
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * Builds a deterministic amortization / markup schedule.
 * All money is handled as integer cents; each row is rounded to 2 decimals and
 * the final row closes any residual balance so the schedule always balances.
 */
export function calculatePaymentPlan(input = {}) {
  if (!input || typeof input !== 'object') fail('input', 'must be an object')

  const priceCents = toCents(input.price, 'price')
  const downPercent = toPercent(input.downPaymentPercent, 'downPaymentPercent', 0)
  const hasAmount = input.downPaymentAmount !== undefined && input.downPaymentAmount !== null && input.downPaymentAmount !== ''
  const downCents = hasAmount
    ? toCents(input.downPaymentAmount, 'downPaymentAmount')
    : Math.round((priceCents * downPercent) / 100)
  if (downCents > priceCents) fail('downPayment', 'cannot exceed the property price')

  const years = toInteger(input.termYears ?? 0, 'termYears', 0, 10)
  const extraMonths = toInteger(input.termMonths ?? 0, 'termMonths', 0, 11)
  const termMonths = years * 12 + extraMonths
  if (termMonths < 1 || termMonths > 120) fail('term', 'total term must be between 1 and 120 months')

  const frequency = input.frequency || 'MONTHLY'
  if (!INSTALLMENT_FREQUENCIES.includes(frequency)) fail('frequency', 'is not supported')
  const monthStep = INSTALLMENT_MONTH_STEPS[frequency]
  const periodCount = Math.max(1, Math.ceil(termMonths / monthStep))
  const firstDueDate = parseDueDate(input.firstDueDate)

  const annualRatePercent = toPercent(input.annualRatePercent, 'annualRatePercent', 0)
  const rateMode = input.rateMode || 'AMORTIZED'
  if (rateMode !== 'AMORTIZED' && rateMode !== 'FLAT') fail('rateMode', 'must be AMORTIZED or FLAT')
  const currency = typeof input.currency === 'string' && input.currency.trim() ? input.currency.trim().toUpperCase() : 'USD'
  const language = input.language === 'ar' ? 'ar' : 'en'

  const financedCents = priceCents - downCents
  if (financedCents <= 0) fail('downPayment', 'must leave a financed amount greater than zero')

  const balloons = parseBalloons(input.balloons, financedCents, termMonths)
  const balloonsByPeriod = new Map()
  for (const balloon of balloons) {
    const period = Math.ceil(balloon.month / monthStep)
    balloonsByPeriod.set(period, (balloonsByPeriod.get(period) || 0) + balloon.amountCents)
  }
  const totalBalloonCents = balloons.reduce((sum, balloon) => sum + balloon.amountCents, 0)

  const periodsPerYear = 12 / monthStep
  const periodicRate = annualRatePercent / 100 / periodsPerYear
  const rows = []
  let balanceCents = financedCents
  let totalInterestCents = 0
  let totalPaidCents = 0
  let periodicPaymentCents = 0

  if (rateMode === 'AMORTIZED') {
    // Balloons repay principal outside the regular annuity, so only the net
    // financed amount is amortized by the periodic payment.
    const principalForInstallmentsCents = financedCents - totalBalloonCents
    const rawPayment = periodicRate === 0
      ? principalForInstallmentsCents / periodCount
      : (principalForInstallmentsCents * periodicRate) / (1 - Math.pow(1 + periodicRate, -periodCount))
    periodicPaymentCents = Math.floor(rawPayment)

    for (let period = 1; period <= periodCount; period += 1) {
      const interestCents = Math.round(balanceCents * periodicRate)
      const scheduledBalloon = balloonsByPeriod.get(period) || 0
      const balloonCents = Math.min(scheduledBalloon, Math.max(0, balanceCents))
      let principalCents = period === periodCount
        ? Math.max(0, balanceCents - balloonCents)
        : Math.max(0, Math.min(periodicPaymentCents - interestCents, balanceCents - balloonCents))
      const paymentCents = interestCents + principalCents
      balanceCents = Math.max(0, balanceCents - principalCents - balloonCents)
      totalInterestCents += interestCents
      totalPaidCents += paymentCents + balloonCents
      rows.push({
        period,
        month: Math.min(period * monthStep, termMonths),
        dueAt: dateOnly(addMonthsClamped(new Date(`${firstDueDate}T00:00:00Z`), monthStep * (period - 1))),
        payment: toMoney(paymentCents),
        principal: toMoney(principalCents),
        interest: toMoney(interestCents),
        balloon: toMoney(balloonCents),
        balance: toMoney(balanceCents)
      })
    }
  } else {
    const markupCents = Math.round(financedCents * (annualRatePercent / 100) * (termMonths / 12))
    const principalForInstallmentsCents = financedCents - totalBalloonCents
    const principalBase = Math.floor(principalForInstallmentsCents / periodCount)
    const principalRemainder = principalForInstallmentsCents - principalBase * periodCount
    const interestBase = Math.floor(markupCents / periodCount)
    const interestRemainder = markupCents - interestBase * periodCount
    periodicPaymentCents = principalBase + interestBase

    for (let period = 1; period <= periodCount; period += 1) {
      const principalCents = principalBase + (period === periodCount ? principalRemainder : 0)
      const interestCents = interestBase + (period === periodCount ? interestRemainder : 0)
      const scheduledBalloon = balloonsByPeriod.get(period) || 0
      const balloonCents = Math.min(scheduledBalloon, Math.max(0, balanceCents - principalCents))
      const paymentCents = principalCents + interestCents
      balanceCents = Math.max(0, balanceCents - principalCents - balloonCents)
      totalInterestCents += interestCents
      totalPaidCents += paymentCents + balloonCents
      rows.push({
        period,
        month: Math.min(period * monthStep, termMonths),
        dueAt: dateOnly(addMonthsClamped(new Date(`${firstDueDate}T00:00:00Z`), monthStep * (period - 1))),
        payment: toMoney(paymentCents),
        principal: toMoney(principalCents),
        interest: toMoney(interestCents),
        balloon: toMoney(balloonCents),
        balance: toMoney(balanceCents)
      })
    }
  }

  return {
    price: toMoney(priceCents),
    downPayment: toMoney(downCents),
    financedAmount: toMoney(financedCents),
    currency,
    language,
    termMonths,
    periodCount,
    frequency,
    monthStep,
    firstDueDate,
    rateMode,
    annualRatePercent,
    periodicRatePercent: Number((periodicRate * 100).toFixed(8)),
    periodicPayment: toMoney(periodicPaymentCents),
    totalInterest: toMoney(totalInterestCents),
    totalBalloons: toMoney(totalBalloonCents),
    totalPaid: toMoney(totalPaidCents),
    remainingBalance: toMoney(balanceCents),
    balloons: balloons.map((balloon) => ({ month: balloon.month, amount: toMoney(balloon.amountCents) })),
    rows
  }
}

function localeOf(language) {
  return language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US'
}

function pair(en, ar, language) {
  return language === 'ar' ? ar : en
}

export function formatAmortizationMoney(amount, currency = 'USD', language = 'en') {
  const value = typeof amount === 'number' ? amount : Number(String(amount ?? 0))
  if (!Number.isFinite(value)) return '—'
  try {
    return new Intl.NumberFormat(localeOf(language), {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency || 'USD'}`.trim()
  }
}

export function formatAmortizationPercent(value, language = 'en') {
  const numeric = Number(value ?? 0)
  const safe = Number.isFinite(numeric) ? numeric : 0
  return `${new Intl.NumberFormat(localeOf(language), { maximumFractionDigits: 1 }).format(safe)}%`
}

export function formatAmortizationDate(isoDate, language = 'en') {
  if (!isoDate) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate))
  if (!match) return String(isoDate)
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (Number.isNaN(date.getTime())) return String(isoDate)
  return new Intl.DateTimeFormat(localeOf(language) === 'en-US' ? 'en-GB' : localeOf(language), {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date)
}

export function buildAmortizationSummaryText(plan, language, currency) {
  const lang = language === 'ar' || language === 'en'
    ? language
    : (plan?.language === 'ar' ? 'ar' : 'en')
  const code = currency || plan?.currency || 'USD'
  const money = (value) => formatAmortizationMoney(value, code, lang)
  const lines = [
    pair('EstateOS payment plan', 'خطة الدفع في إستيت أوس', lang),
    `${pair('Property price', 'سعر العقار', lang)}: ${money(plan.price)}`,
    `${pair('Down payment', 'الدفعة المقدمة', lang)}: ${money(plan.downPayment)}`,
    `${pair('Financed amount', 'المبلغ الممول', lang)}: ${money(plan.financedAmount)}`,
    `${pair('Term', 'المدة', lang)}: ${plan.termMonths} ${pair('months', 'شهراً', lang)}`,
    `${pair('Rate', 'المعدل', lang)}: ${formatAmortizationPercent(plan.annualRatePercent, lang)} (${plan.rateMode})`,
    `${pair('Periodic payment', 'الدفعة الدورية', lang)}: ${money(plan.periodicPayment)}`,
    `${pair('Total interest / markup', 'إجمالي الفوائد أو الهامش', lang)}: ${money(plan.totalInterest)}`,
    `${pair('Total balloons', 'إجمالي الدفعات الكبيرة', lang)}: ${money(plan.totalBalloons)}`,
    `${pair('Total paid', 'إجمالي المدفوع', lang)}: ${money(plan.totalPaid)}`,
    '',
    [pair('Due date', 'تاريخ الاستحقاق', lang), pair('Payment', 'الدفعة', lang), pair('Interest', 'الفائدة', lang), pair('Principal', 'أصل الدين', lang), pair('Balloon', 'دفعة كبيرة', lang), pair('Balance', 'الرصيد', lang)].join(' | ')
  ]
  for (const row of plan.rows) {
    lines.push([
      formatAmortizationDate(row.dueAt, lang),
      money(row.payment),
      money(row.interest),
      money(row.principal),
      money(row.balloon),
      money(row.balance)
    ].join(' | '))
  }
  return lines.join('\n')
}

export function buildAmortizationWhatsAppMessage(plan, language, currency) {
  const lang = language === 'ar' || language === 'en'
    ? language
    : (plan?.language === 'ar' ? 'ar' : 'en')
  return `${pair('EstateOS payment plan', 'خطة دفع إستيت أوس', lang)}\n${buildAmortizationSummaryText(plan, lang, currency)}`
}
