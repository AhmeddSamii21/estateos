export const QUOTA_PERIOD_MONTHS = { month: 1, quarter: 3, year: 12 } as const
export type QuotaPeriod = keyof typeof QUOTA_PERIOD_MONTHS

export type QuotaStatus = 'NO_TARGET' | 'BELOW' | 'NEAR' | 'ON_TRACK' | 'EXCEEDED'

export interface LeaderboardRow {
  userId: string
  name: string
  role: string
  monthlyTarget: string | null
  target: string | null
  value: string
  attainment: number | null
  status: QuotaStatus
  dealCount: number
  wonLeadCount: number
  completedAppointmentCount: number
  currencyBreakdown: Array<{ currency: string; amount: string }>
  rank: number
}

export interface LeaderboardMetricInput {
  userId: string
  name: string
  role: string
  monthlyTarget: string | null
  value: string
  dealCount: number
  wonLeadCount: number
  completedAppointmentCount: number
  currencyBreakdown?: Array<{ currency: string; amount: string }>
}

export function isQuotaPeriod(value: unknown): value is QuotaPeriod {
  return typeof value === 'string' && value in QUOTA_PERIOD_MONTHS
}

export function quotaForPeriod(monthlyTarget: string | number | null | undefined, period: QuotaPeriod, months?: number): number | null {
  if (monthlyTarget === null || monthlyTarget === undefined || monthlyTarget === '') return null
  const monthly = Number(monthlyTarget)
  if (!Number.isFinite(monthly) || monthly < 0) return null
  const multiplier = months !== undefined && Number.isFinite(months) && months > 0
    ? months
    : QUOTA_PERIOD_MONTHS[period]
  return Math.round(monthly * multiplier * 100) / 100
}

export function attainmentPercent(value: string | number, target: string | number | null): number | null {
  if (target === null || target === undefined) return null
  const achieved = Number(value)
  const goal = Number(target)
  if (!Number.isFinite(achieved) || !Number.isFinite(goal) || goal <= 0) return null
  return Math.round((achieved / goal) * 1000) / 10
}

export function quotaStatus(attainment: number | null): QuotaStatus {
  if (attainment === null) return 'NO_TARGET'
  if (attainment >= 100) return 'EXCEEDED'
  if (attainment >= 80) return 'ON_TRACK'
  if (attainment >= 50) return 'NEAR'
  return 'BELOW'
}

export function rankLeaderboard(
  rows: LeaderboardMetricInput[],
  options: { period?: QuotaPeriod; months?: number } = {}
): LeaderboardRow[] {
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
    return left.name.localeCompare(right.name)
  })

  return enriched.map((row, index) => ({ ...row, rank: index + 1 }))
}

export function leaderboardCsv(rows: LeaderboardRow[], language: 'en' | 'ar'): string {
  const headers = language === 'ar'
    ? ['الترتيب', 'الاسم', 'الدور', 'الهدف', 'المحقق', 'النسبة', 'الحالة', 'الصفقات', 'عملاء محتملون', 'مواعيد']
    : ['Rank', 'Name', 'Role', 'Target', 'Achieved', 'Attainment %', 'Status', 'Deals', 'Won leads', 'Appointments']
  const escape = (value: unknown): string => {
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
