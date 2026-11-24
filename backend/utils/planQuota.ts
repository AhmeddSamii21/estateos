import { PlanTier } from '@prisma/client'
import { prisma } from '../prisma'
import { createError } from '../middleware/errorHandler'

export type QuotaKey = 'users' | 'properties' | 'deals' | 'storageMb'
export type QuotaLimits = Record<QuotaKey, number | null>
export type QuotaUsage = Record<QuotaKey, number>

export const PLAN_LIMITS: Record<PlanTier, QuotaLimits> = {
  FREE: { users: 50, properties: 200, deals: 1000, storageMb: 100 },
  STARTER: { users: 150, properties: 1000, deals: 5000, storageMb: 1000 },
  GROWTH: { users: 500, properties: 5000, deals: 25000, storageMb: 10000 },
  ENTERPRISE: { users: null, properties: null, deals: null, storageMb: null }
}

export const QUOTA_LABELS: Record<QuotaKey, [string, string]> = {
  users: ['Team members', 'أعضاء الفريق'],
  properties: ['Properties', 'العقارات'],
  deals: ['Deals', 'الصفقات'],
  storageMb: ['Document storage (MB)', 'مساحة المستندات (ميجابايت)']
}

export interface QuotaEntry {
  key: QuotaKey
  label: string
  labelAr: string
  used: number
  limit: number | null
  remaining: number | null
  percent: number | null
  status: 'UNLIMITED' | 'OK' | 'WARNING' | 'LIMIT_REACHED'
}

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLAN_LIMITS, value)
}

/** Overrides are per-tenant caps; a null override explicitly means unlimited. */
export function resolveLimits(plan: PlanTier, overrides: Partial<QuotaLimits> | null | undefined): QuotaLimits {
  const base = PLAN_LIMITS[plan] || PLAN_LIMITS.FREE
  const result = { ...base }
  for (const key of Object.keys(base) as QuotaKey[]) {
    const override = overrides?.[key]
    if (override === null) result[key] = null
    else if (typeof override === 'number' && Number.isFinite(override) && override >= 0) result[key] = Math.floor(override)
  }
  return result
}

export function quotaEntries(usage: QuotaUsage, limits: QuotaLimits, language: 'en' | 'ar' = 'en'): QuotaEntry[] {
  return (Object.keys(limits) as QuotaKey[]).map((key) => {
    const limit = limits[key]
    const used = Math.max(0, Math.floor(usage[key] || 0))
    const remaining = limit === null ? null : Math.max(0, limit - used)
    const percent = limit === null || limit === 0 ? null : Math.round((used / limit) * 1000) / 10
    const status = limit === null
      ? 'UNLIMITED'
      : used >= limit
        ? 'LIMIT_REACHED'
        : (percent !== null && percent >= 80) ? 'WARNING' : 'OK'
    const [label, labelAr] = QUOTA_LABELS[key]
    return {
      key,
      label: language === 'ar' ? labelAr : label,
      labelAr,
      used,
      limit,
      remaining,
      percent,
      status
    }
  })
}

export function parseQuotaOverrides(body: unknown): Partial<QuotaLimits> {
  if (body === undefined || body === null) return {}
  if (typeof body !== 'object' || Array.isArray(body)) throw createError('overrides must be an object', 400)
  const overrides: Partial<QuotaLimits> = {}
  for (const key of Object.keys(PLAN_LIMITS.FREE) as QuotaKey[]) {
    const value = (body as Record<string, unknown>)[key]
    if (value === undefined) continue
    if (value === null) {
      overrides[key] = null
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000000) {
      throw createError(`${key} must be a non-negative integer or null`, 400)
    }
    overrides[key] = Math.floor(value)
  }
  return overrides
}

async function usageOf(organizationId: string): Promise<QuotaUsage> {
  const [users, properties, deals, documents] = await Promise.all([
    prisma.user.count({ where: { organizationId, deletedAt: null } }),
    prisma.property.count({ where: { organizationId, deletedAt: null } }),
    prisma.deal.count({ where: { organizationId, deletedAt: null } }),
    prisma.document.aggregate({ where: { organizationId, deletedAt: null }, _sum: { size: true } })
  ])
  return {
    users,
    properties,
    deals,
    storageMb: Math.ceil((documents._sum.size || 0) / (1024 * 1024))
  }
}

export async function readQuota(organizationId: string, language: 'en' | 'ar' = 'en') {
  const row = await prisma.planQuota.findUnique({ where: { organizationId } })
  const plan = row && isPlanTier(row.plan) ? row.plan : PlanTier.FREE
  const overrides = row
    ? {
        users: row.userLimit,
        properties: row.propertyLimit,
        deals: row.dealLimit,
        storageMb: row.storageMbLimit
      }
    : null
  const limits = resolveLimits(plan, overrides)
  const usage = await usageOf(organizationId)
  return {
    plan,
    isActive: row?.isActive ?? true,
    updatedAt: row?.updatedAt ?? null,
    limits,
    usage,
    entries: quotaEntries(usage, limits, language)
  }
}

/** Called before tenant-owned writes so plan caps are enforced, not just reported. */
export async function enforceQuota(organizationId: string, key: Exclude<QuotaKey, 'storageMb'>): Promise<void> {
  const row = await prisma.planQuota.findUnique({ where: { organizationId } })
  if (row && !row.isActive) return
  const plan = row && isPlanTier(row.plan) ? row.plan : PlanTier.FREE
  const limits = resolveLimits(plan, row ? {
    users: row.userLimit,
    properties: row.propertyLimit,
    deals: row.dealLimit,
    storageMb: row.storageMbLimit
  } : null)
  const limit = limits[key]
  if (limit === null) return
  const usage = await usageOf(organizationId)
  if (usage[key] >= limit) {
    const [label] = QUOTA_LABELS[key]
    throw createError(`Plan limit reached for ${label.toLowerCase()} (${limit})`, 409)
  }
}
