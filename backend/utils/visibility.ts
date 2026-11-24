import type { Request } from 'express'
import { Prisma, Role } from '@prisma/client'
import { createError } from '../middleware/errorHandler'
import { prisma } from '../prisma'
import { organizationIdOf, roleOf, userIdOf } from './scope'

/**
 * Package 27 visibility:
 * - ADMIN / MANAGER / ACCOUNTANT keep their existing organization-wide reads.
 * - TEAM_LEAD sees own records plus records owned by their team or branch.
 * - AGENT sees only own records, while the shared property catalog rules in
 *   leads/properties keep working exactly as before.
 *
 * The context is resolved once per request from the database (never from a
 * JWT claim) and cached on the request object.
 */
export interface VisibilityContext {
  mode: 'all' | 'own' | 'team'
  userId: string
  userIds: string[]
  teamIds: string[]
  branchIds: string[]
}

const cache = new WeakMap<Request, Promise<VisibilityContext>>()

export function visibility(req: Request): Promise<VisibilityContext> {
  const cached = cache.get(req)
  if (cached) return cached
  const pending = resolveVisibility(req)
  cache.set(req, pending)
  return pending
}

async function resolveVisibility(req: Request): Promise<VisibilityContext> {
  const organizationId = organizationIdOf(req)
  const userId = userIdOf(req)
  const role = roleOf(req)
  if (role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTANT) {
    return { mode: 'all', userId, userIds: [userId], teamIds: [], branchIds: [] }
  }
  if (role === Role.TEAM_LEAD) {
    const actor = await prisma.user.findFirst({
      where: { id: userId, organizationId, deletedAt: null },
      select: { id: true, teamId: true, branchId: true }
    })
    if (!actor) throw createError('Invalid token payload.', 401)
    const targets: Prisma.UserWhereInput[] = [{ id: userId }]
    if (actor.teamId) targets.push({ teamId: actor.teamId })
    if (actor.branchId) targets.push({ branchId: actor.branchId })
    const members = await prisma.user.findMany({
      where: { organizationId, deletedAt: null, OR: targets },
      select: { id: true, teamId: true, branchId: true }
    })
    const teamIds = unique([actor.teamId, ...members.map((member) => member.teamId)])
    const branchIds = unique([actor.branchId, ...members.map((member) => member.branchId)])
    return { mode: 'team', userId, userIds: unique(members.map((member) => member.id)), teamIds, branchIds }
  }
  return { mode: 'own', userId, userIds: [userId], teamIds: [], branchIds: [] }
}

/** Returns a context only for TEAM_LEAD; every other role keeps legacy behavior. */
export async function teamVisibility(req: Request): Promise<VisibilityContext | null> {
  return roleOf(req) === Role.TEAM_LEAD ? visibility(req) : null
}

/** Appends a visibility predicate without overwriting other list filters. */
export function andWhere<T extends Record<string, unknown>>(where: T, clause: Record<string, unknown>): T {
  const existing = where.AND
  const parts = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing]
  return { ...where, AND: [...parts, clause] } as T
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

/** Property catalog visibility; agents keep their assigned-agent rule. */
export function propertyVisibility(ctx: VisibilityContext): Prisma.PropertyWhereInput {
  if (ctx.mode === 'all') return {}
  if (ctx.mode === 'own') return { assignedAgentId: ctx.userId }
  return {
    OR: [
      { assignedAgentId: { in: ctx.userIds } },
      { teamId: { in: ctx.teamIds } },
      { branchId: { in: ctx.branchIds } }
    ]
  }
}

/** A lead is visible when owned by a visible user or linked to a visible property. */
export function leadVisibility(ctx: VisibilityContext): Prisma.LeadWhereInput {
  if (ctx.mode === 'all') return {}
  return {
    OR: [
      { assignedToId: { in: ctx.userIds } },
      { property: propertyVisibility(ctx) }
    ]
  }
}

export function dealVisibility(ctx: VisibilityContext): Prisma.DealWhereInput {
  if (ctx.mode === 'all') return {}
  return {
    OR: [
      { userId: { in: ctx.userIds } },
      { property: propertyVisibility(ctx) }
    ]
  }
}

export function userVisibility(ctx: VisibilityContext, field: string): Record<string, unknown> | null {
  if (ctx.mode === 'all') return null
  return { [field]: ctx.mode === 'own' ? ctx.userId : { in: ctx.userIds } }
}

interface OwnedRow {
  userId?: string | null
  assignedToId?: string | null
  assignedAgentId?: string | null
  teamId?: string | null
  branchId?: string | null
}

/** Synchronous guard for detail/write endpoints that already loaded a row. */
export function canSee(ctx: VisibilityContext, row: OwnedRow, kind: 'user' | 'property' | 'lead' | 'deal'): boolean {
  if (ctx.mode === 'all') return true
  if (ctx.mode === 'own') {
    if (kind === 'property') return row.assignedAgentId === ctx.userId
    if (kind === 'lead') return row.assignedToId === ctx.userId
    return row.userId === ctx.userId
  }
  const ownerId = kind === 'property' ? row.assignedAgentId : kind === 'lead' ? row.assignedToId : row.userId
  return (
    Boolean(ownerId && ctx.userIds.includes(ownerId)) ||
    Boolean(row.teamId && ctx.teamIds.includes(row.teamId)) ||
    Boolean(row.branchId && ctx.branchIds.includes(row.branchId))
  )
}
