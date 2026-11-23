import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { organizationIdOf, userIdOf } from '../utils/scope'
import { pagination } from '../utils/validation'

const router = Router()
router.use(authMiddleware)

function scope(userId: string, organizationId: string): Prisma.NotificationWhereInput {
  return {
    userId,
    OR: [{ organizationId }, { organizationId: null }]
  }
}

router.get('/', async (req, res, next) => {
  try {
    const userId = userIdOf(req)
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const unreadOnly = String(req.query.unread || req.query.isRead || '') === 'true' || String(req.query.unread) === '1'
    const where = scope(userId, organizationId)
    if (unreadOnly) where.isRead = false

    const [total, notifications, unreadCount] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.notification.count({ where: { ...scope(userId, organizationId), isRead: false } })
    ])
    res.json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    next(error)
  }
})

router.get('/unread-count', async (req, res, next) => {
  try {
    const userId = userIdOf(req)
    const organizationId = organizationIdOf(req)
    const count = await prisma.notification.count({ where: { ...scope(userId, organizationId), isRead: false } })
    res.json({ success: true, data: { count } })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/read', async (req, res, next) => {
  try {
    const userId = userIdOf(req)
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.notification.findFirst({ where: { id, ...scope(userId, organizationId) } })
    if (!existing) throw createError('Notification not found', 404)
    const notification = await prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: existing.readAt || new Date() }
    })
    res.json({ success: true, data: notification })
  } catch (error) {
    next(error)
  }
})

router.patch('/read-all', async (req, res, next) => {
  try {
    const userId = userIdOf(req)
    const organizationId = organizationIdOf(req)
    const result = await prisma.notification.updateMany({
      where: { ...scope(userId, organizationId), isRead: false },
      data: { isRead: true, readAt: new Date() }
    })
    res.json({ success: true, data: { updated: result.count } })
  } catch (error) {
    next(error)
  }
})

export default router
