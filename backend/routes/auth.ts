import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { AccountStatus, Prisma, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, hashPassword, comparePassword } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { userIdOf } from '../utils/scope'
import { enumValue, optionalString, requiredString } from '../utils/validation'
import { resolveOrganization } from '../utils/organization'
import { logAudit } from '../utils/audit'

const router = Router()

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
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    accountStatus: user.accountStatus ?? undefined,
    statusReason: user.statusReason ?? undefined,
    firstName: user.firstName ?? null,
    profileImage: user.profileImage ?? undefined,
    avatarUrl: user.avatarUrl ?? null,
    phone: user.phone ?? null,
    jobTitle: user.jobTitle ?? null,
    preferredLang: user.preferredLang || 'en',
    monthlyTargetAmount: targetAmount(user.monthlyTargetAmount),
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt ?? undefined,
    loginCount: user.loginCount ?? undefined,
    createdAt: user.createdAt ?? undefined
  }
}

function issueToken(user: {
  id: string
  email: string
  role: Role
  organizationId: string
  tokenVersion: number
}): string {
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) throw createError('Server authentication is not configured', 500)
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      tokenVersion: user.tokenVersion
    },
    jwtSecret,
    { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'] }
  )
}

// Self-service registration intentionally creates only AGENT accounts.
// Privileged roles must be assigned by an administrator through /api/users.
router.post('/register', async (req, res, next) => {
  try {
    const email = requiredString(req.body?.email, 'email', 254).toLowerCase()
    const password = requiredString(req.body?.password, 'password', 200)
    if (password.length < 8) throw createError('Password must be at least 8 characters', 400)
    if (!/^\S+@\S+\.\S+$/.test(email)) throw createError('A valid email is required', 400)

    const firstName = optionalString(req.body?.firstName, 'firstName', 100)

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) throw createError('User with this email already exists', 409)

    // Public registration must never let the caller pick a tenant. Org-specific
    // users are created by administrators through /api/users; self-registration
    // always lands in the configured default organization.
    const organization = await resolveOrganization()
    const user = await prisma.user.create({
      data: {
        email,
        password: await hashPassword(password),
        role: Role.AGENT,
        organizationId: organization.id,
        firstName,
        isActive: true
      }
    })

    const jwtToken = issueToken(user)

    res.status(201).json({ success: true, data: { ...safeUser(user), token: jwtToken } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('User with this email already exists', 409))
    }
    next(error)
  }
})

router.post('/login', async (req, res, next) => {
  try {
    const email = requiredString(req.body?.email, 'email', 254).toLowerCase()
    const password = requiredString(req.body?.password, 'password', 200)

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.isActive || user.deletedAt || user.accountStatus !== AccountStatus.ACTIVE) {
      throw createError('Invalid credentials', 401)
    }
    const organization = await prisma.organization.findFirst({
      where: { id: user.organizationId, isActive: true, deletedAt: null },
      select: { id: true }
    })
    if (!organization || !(await comparePassword(password, user.password))) {
      throw createError('Invalid credentials', 401)
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), loginCount: { increment: 1 } }
    })

    const token = issueToken(user)

    res.json({ success: true, data: { ...safeUser(user), token } })
  } catch (error) {
    next(error)
  }
})

router.post('/logout', authMiddleware, async (req, res, next) => {
  try {
    // Bump the server-side version so every token issued before this logout is
    // rejected on subsequent requests, even though JWTs themselves are stateless.
    await prisma.user.update({
      where: { id: userIdOf(req) },
      data: { tokenVersion: { increment: 1 } }
    })
    res.json({ success: true, message: 'Logged out successfully' })
  } catch (error) {
    next(error)
  }
})

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const [user, settings] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userIdOf(req) },
        select: {
          id: true, email: true, role: true, organizationId: true,
          accountStatus: true, statusReason: true, firstName: true,
          profileImage: true, avatarUrl: true, phone: true, jobTitle: true,
          preferredLang: true, monthlyTargetAmount: true, isActive: true,
          lastLoginAt: true, loginCount: true, createdAt: true
        }
      }),
      prisma.settings.findUnique({ where: { organizationId: req.user!.organizationId }, select: { defaultLanguage: true } })
    ])
    if (!user) throw createError('User not found', 404)
    res.json({
      success: true,
      data: {
        ...safeUser(user),
        preferredLang: user.preferredLang,
        defaultLanguage: settings?.defaultLanguage || 'en'
      }
    })
  } catch (error) {
    next(error)
  }
})

/** Package 29: any authenticated user may update their own profile. */
router.patch('/me', authMiddleware, async (req, res, next) => {
  try {
    const id = userIdOf(req)
    const body = req.body as Record<string, unknown> | undefined
    const data: Prisma.UserUpdateInput = {}

    if (body?.firstName !== undefined) data.firstName = optionalString(body.firstName, 'firstName', 100)
    if (body?.phone !== undefined) data.phone = optionalString(body.phone, 'phone', 50)
    if (body?.jobTitle !== undefined) data.jobTitle = optionalString(body.jobTitle, 'jobTitle', 120)
    if (body?.avatarUrl !== undefined) data.avatarUrl = optionalAvatarUrl(body.avatarUrl)
    if (body?.preferredLang !== undefined) {
      data.preferredLang = enumValue(body.preferredLang, 'preferredLang', ['en', 'ar'] as const)
    }
    if (!Object.keys(data).length) throw createError('No profile fields to update', 400)

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id }, data })
      await logAudit(tx, {
        userId: id,
        action: 'USER_PROFILE_UPDATED',
        entityType: 'User',
        entityId: id,
        details: { fields: Object.keys(data) }
      })
      return user
    })
    res.json({ success: true, data: safeUser(updated), message: 'Profile updated successfully' })
  } catch (error) {
    next(error)
  }
})

/** Package 29: password changes require the current password and revoke all sessions. */
router.post('/change-password', authMiddleware, async (req, res, next) => {
  try {
    const id = userIdOf(req)
    const currentPassword = requiredString(req.body?.currentPassword, 'currentPassword', 200)
    const newPassword = requiredString(req.body?.newPassword, 'newPassword', 200)
    if (req.body?.confirmPassword !== undefined) {
      const confirmPassword = requiredString(req.body.confirmPassword, 'confirmPassword', 200)
      if (confirmPassword !== newPassword) throw createError('Passwords do not match', 400)
    }
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      throw createError('Password must be at least 8 characters and include a letter and a number', 400)
    }

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, password: true } })
    if (!user) throw createError('User not found', 404)
    if (!(await comparePassword(currentPassword, user.password))) {
      throw createError('Current password is incorrect', 401)
    }
    if (currentPassword === newPassword) {
      throw createError('New password must differ from the current password', 400)
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { password: await hashPassword(newPassword), tokenVersion: { increment: 1 } }
      })
      await logAudit(tx, {
        userId: id,
        action: 'USER_PASSWORD_CHANGED',
        entityType: 'User',
        entityId: id
      })
    })
    res.json({ success: true, message: 'Password changed. Please sign in again.' })
  } catch (error) {
    next(error)
  }
})

export default router
