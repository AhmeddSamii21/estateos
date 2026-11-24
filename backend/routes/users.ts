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
  numberValue,
  optionalString,
  pagination,
  requiredString
} from '../utils/validation'
import { logAudit } from '../utils/audit'

const router = Router()
router.use(authMiddleware)

function targetAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

function optionalAvatarUrl(value: unknown): string | undefined {
  const url = optionalString(value, 'avatarUrl', 2048)
  if (url === undefined) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('invalid scheme')
  } catch {
    throw createError('avatarUrl must be a valid http(s) URL', 400)
  }
  return url
}

function safeUser(user: {
  id: string
  email: string
  role: string
  organizationId: string
  accountStatus?: string | null
  statusReason?: string | null
  firstName?: string | null
  profileImage?: string | null
  avatarUrl?: string | null
  phone?: string | null
  jobTitle?: string | null
  preferredLang?: string | null
  monthlyTargetAmount?: unknown
  isActive?: boolean
  lastLoginAt?: Date | null
  loginCount?: number | null
  createdAt?: Date | null
  deletedAt?: Date | null
  branchId?: string | null
  teamId?: string | null
  _count?: { leads?: number; deals?: number }
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
    avatarUrl: user.avatarUrl ?? null,
    phone: user.phone ?? null,
    jobTitle: user.jobTitle ?? null,
    preferredLang: user.preferredLang || 'en',
    monthlyTargetAmount: targetAmount(user.monthlyTargetAmount),
    assignedCounts: {
      leads: user._count?.leads ?? 0,
      deals: user._count?.deals ?? 0
    },
    activeLeads: user._count?.leads ?? 0,
    activeDeals: user._count?.deals ?? 0,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt ?? undefined,
    loginCount: user.loginCount ?? undefined,
    createdAt: user.createdAt ?? undefined,
    deletedAt: user.deletedAt ?? null
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
  profileImage: true,
  avatarUrl: true,
  phone: true,
  jobTitle: true,
  preferredLang: true,
  monthlyTargetAmount: true,
  isActive: true,
  lastLoginAt: true,
  loginCount: true,
  createdAt: true,
  deletedAt: true,
  branchId: true,
  teamId: true
} as const

const listSelect = {
  ...select,
  _count: {
    select: {
      leads: { where: { isActive: true, deletedAt: null } },
      deals: { where: { isActive: true, deletedAt: null } }
    }
  }
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
    // Package 30: management may opt into deactivated accounts for restoration;
    // TEAM_LEAD visibility never expands to inactive users.
    const includeInactive = roleOf(req) !== Role.TEAM_LEAD &&
      String(req.query.includeInactive || '').toLowerCase() === 'true'
    const where: Prisma.UserWhereInput = {
      organizationId,
      ...(includeInactive ? {} : { deletedAt: null })
    }
    if (roleOf(req) === Role.TEAM_LEAD) {
      const scope = userVisibility(await visibility(req), 'id')
      if (scope) Object.assign(where, scope)
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select: listSelect })
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
    const user = await prisma.user.findFirst({ where, select: listSelect })
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
    const phone = optionalString(req.body?.phone, 'phone', 50)
    const jobTitle = optionalString(req.body?.jobTitle, 'jobTitle', 120)
    const avatarUrl = optionalAvatarUrl(req.body?.avatarUrl)
    const preferredLang = req.body?.preferredLang === undefined
      ? 'en'
      : enumValue(req.body.preferredLang, 'preferredLang', ['en', 'ar'] as const)
    const monthlyTargetAmount = numberValue(req.body?.monthlyTargetAmount, 'monthlyTargetAmount', { min: 0 })
    const isActive = booleanValue(req.body?.isActive, 'isActive', true)
    const branchId = optionalString(req.body?.branchId, 'branchId', 100)
    const teamId = optionalString(req.body?.teamId, 'teamId', 100)
    await assertHierarchyRefs(organizationId, branchId, teamId)

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          password: await hashPassword(password),
          role,
          firstName,
          phone,
          jobTitle,
          avatarUrl,
          preferredLang,
          monthlyTargetAmount,
          isActive,
          organizationId,
          branchId,
          teamId
        },
        select
      })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'USER_CREATED',
        entityType: 'User',
        entityId: created.id,
        details: { role, branchId: branchId || null, teamId: teamId || null }
      })
      return created
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
    if (id === actorId && body.password !== undefined) {
      throw createError('Use the change-password endpoint for your own account', 400)
    }
    if (body.password !== undefined && actorRole !== Role.ADMIN) {
      throw createError('Only ADMIN accounts can reset another user password', 403)
    }

    const data: Prisma.UserUpdateInput = {}
    if (body.email !== undefined) {
      const email = requiredString(body.email, 'email', 254).toLowerCase()
      if (!/^\S+@\S+\.\S+$/.test(email)) throw createError('A valid email is required', 400)
      data.email = email
    }
    if (body.firstName !== undefined) data.firstName = optionalString(body.firstName, 'firstName', 100)
    if (body.phone !== undefined) data.phone = optionalString(body.phone, 'phone', 50)
    if (body.jobTitle !== undefined) data.jobTitle = optionalString(body.jobTitle, 'jobTitle', 120)
    if (body.avatarUrl !== undefined) data.avatarUrl = optionalAvatarUrl(body.avatarUrl)
    if (body.preferredLang !== undefined) {
      data.preferredLang = enumValue(body.preferredLang, 'preferredLang', ['en', 'ar'] as const)
    }
    if (body.monthlyTargetAmount !== undefined) {
      data.monthlyTargetAmount = numberValue(body.monthlyTargetAmount, 'monthlyTargetAmount', { min: 0 })
    }
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
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        throw createError('Password must be at least 8 characters and include a letter and a number', 400)
      }
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

      const updated = await tx.user.update({ where: { id }, data, select })
      await logAudit(tx, {
        userId: actorId,
        action: body.password !== undefined ? 'USER_PASSWORD_RESET' : 'USER_UPDATED',
        entityType: 'User',
        entityId: id,
        details: { fields: Object.keys(data).filter((key) => key !== 'password' && key !== 'tokenVersion') }
      })
      return updated
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

      const updated = await tx.user.update({
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
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'USER_DEACTIVATED',
        entityType: 'User',
        entityId: id
      })
      return updated
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    res.json({ success: true, data: safeUser(user), message: 'User deactivated successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return next(createError('Concurrent user update conflict; please retry', 409))
    }
    next(error)
  }
})

/** Package 30: reactivate a deactivated user without ever changing their role. */
router.post('/:id/restore', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const actorRole = roleOf(req)
    const id = String(req.params.id)

    const user = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findFirst({
        where: { id, organizationId },
        select: { role: true, isActive: true, accountStatus: true, deletedAt: true }
      })
      if (!current) throw createError('User not found', 404)
      assertManagerCannotManageAdmin(actorRole, current.role)
      if (!current.deletedAt && current.isActive && current.accountStatus === AccountStatus.ACTIVE) {
        throw createError('User is already active', 400)
      }
      const updated = await tx.user.update({
        where: { id },
        data: {
          isActive: true,
          deletedAt: null,
          accountStatus: AccountStatus.ACTIVE,
          statusReason: null,
          tokenVersion: { increment: 1 }
        },
        select
      })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'USER_RESTORED',
        entityType: 'User',
        entityId: id
      })
      return updated
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    res.json({ success: true, data: safeUser(user), message: 'User restored successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return next(createError('Concurrent user update conflict; please retry', 409))
    }
    next(error)
  }
})

export default router
