import type { Request } from 'express'
import { createError } from '../middleware/errorHandler'
import { Prisma, Role } from '@prisma/client'

export function organizationIdOf(req: Request): string {
  const organizationId = req.user?.organizationId
  if (!organizationId) {
    throw createError('Organization context is required', 403)
  }
  return organizationId
}

export function userIdOf(req: Request): string {
  if (!req.user?.id) throw createError('Authentication is required', 401)
  return req.user.id
}

export function roleOf(req: Request): Role | undefined {
  return req.user?.role as Role | undefined
}

export function requireAnyRole(req: Request, roles: Role[]): void {
  const role = roleOf(req)
  if (!role || !roles.includes(role)) {
    throw createError('Insufficient permissions', 403)
  }
}

export const MANAGEMENT_ROLES: Role[] = [Role.ADMIN, Role.MANAGER]
export const FINANCE_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]
export const REPORT_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]

/**
 * A lead is local only when every non-null relation also resolves locally.
 * Keeping this in one place prevents weaker OR-only copies from letting a
 * mixed-relation lead appear in two tenants.
 */
export function leadScope(organizationId: string): Prisma.LeadWhereInput {
  return {
    AND: [
      { OR: [{ property: { organizationId } }, { assignedTo: { organizationId } }] },
      { OR: [{ propertyId: null }, { property: { organizationId } }] },
      { OR: [{ assignedToId: null }, { assignedTo: { organizationId } }] }
    ]
  }
}

/**
 * Owners predate mandatory organization ownership. Null-org owners are only
 * readable when they are genuinely linked to a property in this organization.
 */
export function ownerReadScope(organizationId: string): Prisma.OwnerWhereInput {
  return {
    OR: [
      { organizationId },
      { organizationId: null, properties: { some: { organizationId, deletedAt: null } } }
    ]
  }
}
