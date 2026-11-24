import { LeadPriorityTier } from '@prisma/client'

export const LEAD_PRIORITY_TIERS = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

export interface LeadPriorityInput {
  source?: unknown
  status?: unknown
  budgetMin?: unknown
  budgetMax?: unknown
  email?: unknown
  phone?: unknown
  preferredType?: unknown
  preferredCity?: unknown
  propertyId?: unknown
  createdAt?: unknown
  nextFollowUpAt?: unknown
  lastContactedAt?: unknown
}

export interface LeadPriorityResult {
  priorityScore: number
  priorityTier: LeadPriorityTier
}

function asDate(value: unknown): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function asMoney(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

function sourceWeight(source: unknown): number {
  if (typeof source !== 'string' || !source.trim()) return 0
  const normalized = source.trim().toLowerCase()
  if (normalized.includes('referral')) return 18
  if (normalized.includes('website') || normalized === 'web') return 14
  if (normalized.includes('walk')) return 12
  if (normalized.includes('portal')) return 10
  if (normalized.includes('advert') || normalized.includes('campaign')) return 9
  if (normalized.includes('social')) return 8
  return 5
}

function statusWeight(status: unknown): number {
  switch (String(status || '')) {
    case 'NEW': return 14
    case 'CONTACTED': return 10
    case 'QUALIFIED': return 8
    case 'VIEWING': return 7
    case 'NEGOTIATION': return 6
    default: return 0
  }
}

function budgetWeight(budgetMin: unknown, budgetMax: unknown): number {
  const min = asMoney(budgetMin)
  const max = asMoney(budgetMax)
  const value = Math.max(min, max)
  if (!value) return 0
  if (value >= 1_000_000) return 22
  if (value >= 500_000) return 18
  if (value >= 200_000) return 14
  if (value >= 50_000) return 10
  return 6
}

/**
 * Deterministic 0-100 priority. Every input is optional so legacy leads can be
 * recalculated safely; the algorithm never throws on malformed stored values.
 */
export function computeLeadPriority(lead: LeadPriorityInput, now: Date = new Date()): LeadPriorityResult {
  const createdAt = asDate(lead.createdAt)
  const nextFollowUpAt = asDate(lead.nextFollowUpAt)
  const ageInDays = createdAt ? (now.getTime() - createdAt.getTime()) / 86_400_000 : Infinity

  let score = 0
  score += sourceWeight(lead.source)
  score += statusWeight(lead.status)
  score += budgetWeight(lead.budgetMin, lead.budgetMax)
  score += !createdAt ? 0 : ageInDays <= 1 ? 16 : ageInDays <= 7 ? 12 : ageInDays <= 30 ? 6 : 2
  score += lead.email ? 4 : 0
  score += lead.phone ? 4 : 0
  score += lead.preferredType ? 3 : 0
  score += lead.preferredCity ? 2 : 0
  score += lead.propertyId ? 3 : 0
  if (nextFollowUpAt) {
    const delta = nextFollowUpAt.getTime() - now.getTime()
    score += delta < 0 ? 14 : delta <= 86_400_000 ? 10 : 3
  } else if (!lead.lastContactedAt && Number.isFinite(ageInDays) && ageInDays > 7) {
    score += 8
  }

  const priorityScore = Math.max(0, Math.min(100, Math.round(score)))
  return { priorityScore, priorityTier: priorityTierForScore(priorityScore) }
}

export function priorityTierForScore(score: number): LeadPriorityTier {
  if (score >= 75) return LeadPriorityTier.URGENT
  if (score >= 50) return LeadPriorityTier.HIGH
  if (score >= 25) return LeadPriorityTier.MEDIUM
  return LeadPriorityTier.LOW
}
