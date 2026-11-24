export type QuotaStatus = 'UNLIMITED' | 'LIMIT_REACHED' | 'WARNING' | 'OK'

export interface QuotaRow {
  key: string
  label: string
  used: number
  limit: number | null
  remaining: number | null
  percent: number | null
  status: QuotaStatus
}

export declare const PLAN_LIMITS: Readonly<Record<string, Readonly<Record<string, number | null>>>>
export declare const QUOTA_KEYS: readonly string[]

export declare function quotaStatus(used: number, limit: number | null | undefined): QuotaStatus
export declare function quotaPercent(used: number, limit: number | null | undefined): number | null
export declare function quotaRows(usage?: Record<string, number>, limits?: Record<string, number | null>, language?: string): QuotaRow[]
export declare function planName(plan: string, language?: string): string
export declare function upgradeHint(status: QuotaStatus): string
