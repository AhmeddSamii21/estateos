import { Router } from 'express'
import { Prisma, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { logAudit } from '../utils/audit'
import {
  isPlanTier,
  parseQuotaOverrides,
  readQuota,
  resolveLimits,
  type QuotaLimits
} from '../utils/planQuota'
import { organizationIdOf, userIdOf } from '../utils/scope'

const router = Router()
router.use(authMiddleware)

router.get('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const language = req.query.language === 'ar' ? 'ar' : 'en'
    res.json({ success: true, data: await readQuota(organizationId, language) })
  } catch (error) {
    next(error)
  }
})

/** Only tenant administrators may change the paid plan or hard caps. */
router.patch('/', requireRole([Role.ADMIN]), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const current = await prisma.planQuota.findUnique({ where: { organizationId } })
    const currentPlan = current?.plan && isPlanTier(current.plan) ? current.plan : 'FREE'
    const plan = req.body?.plan === undefined
      ? currentPlan
      : isPlanTier(req.body.plan) ? req.body.plan : (() => { throw createError('Invalid plan tier', 400) })()

    const overrides: Partial<QuotaLimits> = current ? {
      users: current.userLimit,
      properties: current.propertyLimit,
      deals: current.dealLimit,
      storageMb: current.storageMbLimit
    } : {}
    Object.assign(overrides, parseQuotaOverrides(req.body?.overrides))

    const limits = resolveLimits(plan, overrides)
    const data = {
      plan,
      userLimit: limits.users,
      propertyLimit: limits.properties,
      dealLimit: limits.deals,
      storageMbLimit: limits.storageMb,
      isActive: req.body?.isActive === undefined ? (current?.isActive ?? true) : Boolean(req.body.isActive)
    }

    const row = await prisma.$transaction(async (tx) => {
      const saved = await tx.planQuota.upsert({
        where: { organizationId },
        create: { organizationId, ...data },
        update: data
      })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'PLAN_QUOTA_UPDATED',
        entityType: 'PlanQuota',
        entityId: saved.id,
        details: { plan, limits: data }
      })
      return saved
    })
    res.json({ success: true, data: await readQuota(organizationId), saved: { id: row.id }, message: 'Plan quota updated' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return next(createError('Organization not found', 404))
    }
    next(error)
  }
})

export default router
