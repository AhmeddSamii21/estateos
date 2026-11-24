import { Router } from 'express'
import { AccountStatus, Prisma, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, hashPassword, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { MANAGEMENT_ROLES, organizationIdOf, roleOf, userIdOf } from '../utils/scope'
import { userVisibility, visibility } from '../utils/visibility'
import { assertHierarchyRefs } from '../utils/hierarchy'
import {
  booleanValue,
  enumValue,
  optionalString,
  pagination,
  requiredString
} from '../utils/validation'

const router = Router()
router.use(authMiddleware)

function safeUser(user: {
  id: string
  email: string
  role: string
  organizationId: string
  accountStatus?: string | null
  statusReason?: string | null
  firstName?: string | null
  profileImage?: string | null
  isActive?: boolean
  lastLoginAt?: Date | null
  loginCount?: number | null
  createdAt?: Date | null
  branchId?: string | null
  teamId?: string | null
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    branchId: user.branchId ?? null,
    teamId: user.teamId ?? null,
    accountStatus: user.accountStatus ?? undefined,
    statusReason: user.statusReason ?? undefined,
    firstName: user.firstName ?? null,
    profileImage: user.profileImage ?? undefined,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt ?? undefined,
    loginCount: user.loginCount ?? undefined,
    createdAt: user.createdAt ?? undefined
  }
}

const select = {
  id: true,
  email: true,
  role: true,
  organizationId: true,
  accountStatus: true,
  statusReason: true,
  firstName: true,
  isActive: true,
  lastLoginAt: true,
  loginCount: true,
  createdAt: true,
  branchId: true,
  teamId: true
} as const

const USER_READ_ROLES: Role[] = [...MANAGEMENT_ROLES, Role.TEAM_LEAD]

function assertManagerCannotManageAdmin(actorRole: Role | undefined, targetRole: Role): void {
  if (actorRole === Role.MANAGER && targetRole === Role.ADMIN) {
    throw createError('MANAGER accounts cannot manage ADMIN accounts', 403)
  }
}

function removesAdminAccess(
  target: { role: Role; isActive: boolean; accountStatus: AccountStatus },
  data: Prisma.UserUpdateInput
): boolean {
  if (target.role !== Role.ADMIN || !target.isActive || target.accountStatus !== AccountStatus.ACTIVE) return false
  return (
    (data.role !== undefined && data.role !== Role.ADMIN) ||
    (data.isActive !== undefined && data.isActive === false) ||
    (data.accountStatus !== undefined && data.accountStatus !== AccountStatus.ACTIVE)
  )
}

async function assertAnotherActiveAdminExists(
  tx: Prisma.TransactionClient,
  organizationId: string,
  targetId: string
): Promise<void> {
  const otherAdmins = await tx.user.count({
    where: {
      organizationId,
      role: Role.ADMIN,
      isActive: true,
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
      id: { not: targetId }
    }
  })
  if (otherAdmins === 0) {
    throw createError('Cannot remove the last active ADMIN account', 400)
  }
}

router.get('/me', async (req, res, next) => {
  try {
    const settings = await prisma.settings.findUnique({ where: { organizationId: req.user!.organizationId }, select: { defaultLanguage: true } })
    res.json({ success: true, data: { ...safeUser(req.user!), defaultLanguage: settings?.defaultLanguage || 'en' } })
  } catch (error) {
    next(error)
  }
})

router.get('/', requireRole(USER_READ_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where: Prisma.UserWhereInput = { organizationId, deletedAt: null }
    if (roleOf(req) === Role.TEAM_LEAD) {
      const scope = userVisibility(await visibility(req), 'id')
      if (scope) Object.assign(where, scope)
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select })
    ])
    res.json({
      success: true,
      data: users.map(safeUser),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    next(error)
  }
})

router.get('/:id', requireRole(USER_READ_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const where: Prisma.UserWhereInput = { id: String(req.params.id), organizationId, deletedAt: null }
    if (roleOf(req) === Role.TEAM_LEAD) {
      const scope = userVisibility(await visibility(req), 'id')
      if (scope) Object.assign(where, scope)
    }
    const user = await prisma.user.findFirst({ where, select })
    if (!user) throw createError('User not found', 404)
    res.json({ success: true, data: safeUser(user) })
  } catch (error) {
    next(error)
  }
})

router.post('/', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const actorRole = roleOf(req)
    const email = requiredString(req.body?.email, 'email', 254).toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(email)) throw createError('A valid email is required', 400)
    const password = requiredString(req.body?.password, 'password', 200)
    if (password.length < 8) throw createError('Password must be at least 8 characters', 400)

    const role = enumValue(req.body?.role, 'role', Object.values(Role), Role.AGENT)
    if (actorRole === Role.MANAGER && role === Role.ADMIN) {
      throw createError('MANAGER accounts cannot create ADMIN accounts', 403)
    }
    const firstName = optionalString(req.body?.firstName, 'firstName', 100)
    const isActive = booleanValue(req.body?.isActive, 'isActive', true)
    const branchId = optionalString(req.body?.branchId, 'branchId', 100)
    const teamId = optionalString(req.body?.teamId, 'teamId', 100)
    await assertHierarchyRefs(organizationId, branchId, teamId)

    const user = await prisma.user.create({
      data: {
        email,
        password: await hashPassword(password),
        role,
        firstName,
        isActive,
        organizationId,
        branchId,
        teamId
      },
      select
    })
    res.status(201).json({ success: true, data: safeUser(user), message: 'User created successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A user with this email already exists', 409))
    }
    next(error)
  }
})

router.patch('/:id', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const actorRole = roleOf(req)
    const actorId = userIdOf(req)
    const id = String(req.params.id)
    const body = req.body as Record<string, unknown>

    // Self-service profile edits are fine, but a manager/admin must never be
    // able to strip their own privileged access through the management API.
    if (id === actorId && body.role !== undefined) {
      throw createError('You cannot change your own role', 403)
    }
    if (id === actorId && (body.accountStatus !== undefined || body.statusReason !== undefined)) {
      throw createError('You cannot change your own account status', 403)
    }
    if (id === actorId && body.isActive === false) {
      throw createError('You cannot deactivate your own account', 400)
    }

    const data: Prisma.UserUpdateInput = {}
    if (body.email !== undefined) {
      const email = requiredString(body.email, 'email', 254).toLowerCase()
      if (!/^\S+@\S+\.\S+$/.test(email)) throw createError('A valid email is required', 400)
      data.email = email
    }
    if (body.firstName !== undefined) data.firstName = optionalString(body.firstName, 'firstName', 100)
    if (body.role !== undefined) data.role = enumValue(body.role, 'role', Object.values(Role))
    if (body.isActive !== undefined) data.isActive = booleanValue(body.isActive, 'isActive')
    if (body.accountStatus !== undefined) {
      const accountStatus = enumValue(body.accountStatus, 'accountStatus', Object.values(AccountStatus))
      data.accountStatus = accountStatus
      if (accountStatus === AccountStatus.ACTIVE && body.statusReason === undefined) data.statusReason = null
    }
    if (body.statusReason !== undefined) data.statusReason = optionalString(body.statusReason, 'statusReason', 500)
    if (body.branchId !== undefined || body.teamId !== undefined) {
      const branchId = body.branchId === undefined ? undefined : optionalString(body.branchId, 'branchId', 100)
      const teamId = body.teamId === undefined ? undefined : optionalString(body.teamId, 'teamId', 100)
      await assertHierarchyRefs(organizationId, branchId, teamId)
      data.branch = branchId === undefined ? undefined : branchId ? { connect: { id: branchId } } : { disconnect: true }
      data.team = teamId === undefined ? undefined : teamId ? { connect: { id: teamId } } : { disconnect: true }
    }
    if (body.password !== undefined) {
      const password = requiredString(body.password, 'password', 200)
      if (password.length < 8) throw createError('Password must be at least 8 characters', 400)
      data.password = await hashPassword(password)
    }

    if (actorRole === Role.MANAGER && data.role === Role.ADMIN) {
      throw createError('MANAGER accounts cannot promote users to ADMIN', 403)
    }

    // Every change that affects access also invalidates tokens issued earlier.
    const revokesSessions = data.role !== undefined ||
      (data.isActive !== undefined && data.isActive === false) ||
      data.accountStatus !== undefined ||
      data.password !== undefined
    if (revokesSessions) data.tokenVersion = { increment: 1 }

    const user = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { role: true, isActive: true, accountStatus: true }
      })
      if (!current) throw createError('User not found', 404)

      assertManagerCannotManageAdmin(actorRole, current.role)

      if (removesAdminAccess(current, data)) {
        await assertAnotherActiveAdminExists(tx, organizationId, id)
      }

      return tx.user.update({ where: { id }, data, select })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    res.json({ success: true, data: safeUser(user), message: 'User updated successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A user with this email already exists', 409))
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return next(createError('Concurrent user update conflict; please retry', 409))
    }
    next(error)
  }
})

router.delete('/:id', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const actorRole = roleOf(req)
    const id = String(req.params.id)
    if (id === userIdOf(req)) throw createError('You cannot deactivate your own account', 400)

    const user = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { role: true, isActive: true, accountStatus: true }
      })
      if (!current) throw createError('User not found', 404)

      assertManagerCannotManageAdmin(actorRole, current.role)

      if (removesAdminAccess(current, { isActive: false, accountStatus: AccountStatus.SUSPENDED })) {
        await assertAnotherActiveAdminExists(tx, organizationId, id)
      }

      return tx.user.update({
        where: { id },
        data: {
          isActive: false,
          deletedAt: new Date(),
          accountStatus: AccountStatus.SUSPENDED,
          statusReason: 'Account deactivated',
          tokenVersion: { increment: 1 }
        },
        select
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    res.json({ success: true, data: safeUser(user), message: 'User deactivated successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return next(createError('Concurrent user update conflict; please retry', 409))
    }
    next(error)
  }
})

export default router
