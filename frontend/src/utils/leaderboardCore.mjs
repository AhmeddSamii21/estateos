// Package 37: pure quota leaderboard math shared by the Vue UI and Node tests.

export const QUOTA_PERIOD_MONTHS = Object.freeze({ month: 1, quarter: 3, year: 12 })

export function isQuotaPeriod(value) {
  return typeof value === 'string' && Object.hasOwn(QUOTA_PERIOD_MONTHS, value)
}

export function quotaForPeriod(monthlyTarget, period = 'month', months) {
  if (monthlyTarget === null || monthlyTarget === undefined || monthlyTarget === '') return null
  const monthly = Number(monthlyTarget)
  if (!Number.isFinite(monthly) || monthly < 0) return null
  const multiplier = Number.isFinite(months) && months > 0
    ? months
    : (QUOTA_PERIOD_MONTHS[period] ?? 1)
  return Math.round(monthly * multiplier * 100) / 100
}

export function attainmentPercent(value, target) {
  if (target === null || target === undefined) return null
  const achieved = Number(value)
  const goal = Number(target)
  if (!Number.isFinite(achieved) || !Number.isFinite(goal) || goal <= 0) return null
  return Math.round((achieved / goal) * 1000) / 10
}

export function quotaStatus(attainment) {
  if (attainment === null) return 'NO_TARGET'
  if (attainment >= 100) return 'EXCEEDED'
  if (attainment >= 80) return 'ON_TRACK'
  if (attainment >= 50) return 'NEAR'
  return 'BELOW'
}

export function rankLeaderboard(rows, options = {}) {
  const enriched = rows.map((row) => {
    const target = quotaForPeriod(row.monthlyTarget, options.period ?? 'month', options.months)
    const attainment = attainmentPercent(row.value, target)
    return {
      ...row,
      target: target === null ? null : target.toFixed(2),
      attainment,
      status: quotaStatus(attainment),
      currencyBreakdown: row.currencyBreakdown || [],
      rank: 0
    }
  })

  enriched.sort((left, right) => {
    const leftScore = left.attainment ?? -1
    const rightScore = right.attainment ?? -1
    if (rightScore !== leftScore) return rightScore - leftScore
    const leftValue = Number(left.value)
    const rightValue = Number(right.value)
    if (rightValue !== leftValue) return rightValue - leftValue
    return String(left.name).localeCompare(String(right.name))
  })

  return enriched.map((row, index) => ({ ...row, rank: index + 1 }))
}

export function leaderboardCsv(rows, language = 'en') {
  const headers = language === 'ar'
    ? ['الترتيب', 'الاسم', 'الدور', 'الهدف', 'المحقق', 'النسبة', 'الحالة', 'الصفقات', 'عملاء محتملون', 'مواعيد']
    : ['Rank', 'Name', 'Role', 'Target', 'Achieved', 'Attainment %', 'Status', 'Deals', 'Won leads', 'Appointments']
  const escape = (value) => {
    let text = value === null || value === undefined ? '' : String(value)
    if (/^[=+@\t\r]/.test(text)) text = `'${text}`
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [headers.map(escape).join(',')]
  for (const row of rows) {
    lines.push([
      row.rank,
      row.name,
      row.role,
      row.target ?? '',
      row.value,
      row.attainment ?? '',
      row.status,
      row.dealCount,
      row.wonLeadCount,
      row.completedAppointmentCount
    ].map(escape).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
