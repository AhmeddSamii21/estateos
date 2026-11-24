export type QuotaPeriod = 'month' | 'quarter' | 'year'
export type QuotaStatus = 'NO_TARGET' | 'BELOW' | 'NEAR' | 'ON_TRACK' | 'EXCEEDED'

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

export interface LeaderboardRow extends LeaderboardMetricInput {
  target: string | null
  attainment: number | null
  status: QuotaStatus
  rank: number
}

export declare const QUOTA_PERIOD_MONTHS: Readonly<Record<QuotaPeriod, number>>

export declare function isQuotaPeriod(value: unknown): value is QuotaPeriod
export declare function quotaForPeriod(
  monthlyTarget: string | number | null | undefined,
  period?: QuotaPeriod,
  months?: number
): number | null
export declare function attainmentPercent(value: string | number, target: string | number | null): number | null
export declare function quotaStatus(attainment: number | null): QuotaStatus
export declare function rankLeaderboard(
  rows: LeaderboardMetricInput[],
  options?: { period?: QuotaPeriod; months?: number }
): LeaderboardRow[]
export declare function leaderboardCsv(rows: LeaderboardRow[], language?: 'en' | 'ar'): string
