import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { AccountStatus, Prisma, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, hashPassword, comparePassword } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { userIdOf } from '../utils/scope'
import { optionalString, requiredString } from '../utils/validation'
import { resolveOrganization } from '../utils/organization'

const router = Router()

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
    const settings = await prisma.settings.findUnique({ where: { organizationId: req.user!.organizationId }, select: { defaultLanguage: true } })
    res.json({ success: true, data: { ...safeUser(req.user!), defaultLanguage: settings?.defaultLanguage || 'en' } })
  } catch (error) {
    next(error)
  }
})

export default router
