import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { MANAGEMENT_ROLES, organizationIdOf } from '../utils/scope'
import { optionalString } from '../utils/validation'

const router = Router()
router.use(authMiddleware, requireRole(MANAGEMENT_ROLES))

router.get('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const settings = await prisma.settings.findUnique({ where: { organizationId } })
    res.json({ success: true, data: settings })
  } catch (error) {
    next(error)
  }
})

router.patch('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const defaultLanguage = optionalString(req.body?.defaultLanguage, 'defaultLanguage', 10) || 'en'
    if (!['en', 'ar'].includes(defaultLanguage)) throw createError('defaultLanguage must be en or ar', 400)
    const defaultCurrency = (optionalString(req.body?.defaultCurrency, 'defaultCurrency', 3) || 'USD').toUpperCase()

    let data: Prisma.InputJsonValue = {}
    if (req.body?.data !== undefined) {
      if (typeof req.body.data !== 'object' || req.body.data === null || Array.isArray(req.body.data)) {
        throw createError('data must be a JSON object', 400)
      }
      data = req.body.data as Prisma.InputJsonValue
    }

    const settings = await prisma.settings.upsert({
      where: { organizationId },
      create: { organizationId, defaultLanguage, defaultCurrency, data },
      update: { defaultLanguage, defaultCurrency, data }
    })
    res.json({ success: true, data: settings, message: 'Settings saved successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return next(createError('Organization not found', 404))
    }
    next(error)
  }
})

export default router
