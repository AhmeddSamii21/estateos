import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { AccountStatus, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { createError } from './errorHandler'

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        email: string
        role: Role
        organizationId: string
        firstName: string | null
        profileImage: string | null
        isActive: boolean
        lastLoginAt: Date | null
        loginCount: number
        createdAt: Date
      }
    }
  }
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw createError('Server authentication is not configured', 500)
  return secret
}

export const authMiddleware = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined

    if (!token) return next(createError('Access denied. No token provided.', 401))

    const decoded = jwt.verify(token, jwtSecret()) as { id?: unknown; tokenVersion?: unknown } | string
    if (
      typeof decoded === 'string' || !decoded ||
      typeof decoded.id !== 'string' || !decoded.id ||
      !Number.isInteger(decoded.tokenVersion)
    ) {
      return next(createError('Invalid token payload.', 401))
    }
    const userId = decoded.id

    // JWT claims identify the caller; the database is authoritative for the
    // current role, organization, token version, and account state on every request.
    const user = await prisma.user.findFirst({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        accountStatus: true,
        tokenVersion: true,
        firstName: true,
        profileImage: true,
        isActive: true,
        deletedAt: true,
        lastLoginAt: true,
        loginCount: true,
        createdAt: true,
        organization: { select: { isActive: true, deletedAt: true } }
      }
    })
    if (!user || !user.organizationId) {
      return next(createError('Invalid token payload.', 401))
    }
    if (!user.isActive || user.deletedAt || user.accountStatus !== AccountStatus.ACTIVE) {
      return next(createError('Account is not active', 401))
    }
    if (!user.organization?.isActive || user.organization.deletedAt) {
      return next(createError('Organization is not active', 401))
    }
    if (decoded.tokenVersion !== user.tokenVersion) {
      return next(createError('Session has been revoked. Please sign in again.', 401))
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      firstName: user.firstName,
      profileImage: user.profileImage,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      loginCount: user.loginCount,
      createdAt: user.createdAt
    }
    next()
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(createError('Token expired', 401))
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return next(createError('Invalid token', 401))
    }
    next(error)
  }
}

export const requireRole = (roles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(createError('User not authenticated', 401))
    if (!roles.includes(req.user.role)) return next(createError('Insufficient permissions', 403))
    next()
  }
}

export const hashPassword = async (password: string): Promise<string> => {
  const configured = Number(process.env.BCRYPT_ROUNDS || 12)
  const rounds = Number.isInteger(configured) && configured >= 10 && configured <= 15 ? configured : 12
  return bcrypt.hash(password, rounds)
}

export const comparePassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  return bcrypt.compare(password, hashedPassword)
}
