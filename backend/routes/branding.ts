import { Router } from 'express'
import { BrandingTheme, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { logAudit } from '../utils/audit'
import {
  brandingResponse,
  brandColor,
  DEFAULT_BRANDING,
  safeBrandUrl,
  type BrandingRecord
} from '../utils/branding'
import { MANAGEMENT_ROLES, organizationIdOf, requireAnyRole, userIdOf } from '../utils/scope'
import { booleanValue, enumValue, optionalString } from '../utils/validation'

const router = Router()
router.use(authMiddleware)

router.get('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const [row, organization] = await Promise.all([
      prisma.organizationBranding.findUnique({ where: { organizationId } }),
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, logoUrl: true, email: true, phone: true }
      })
    ])
    if (!organization) throw createError('Organization not found', 404)
    res.json({ success: true, data: brandingResponse(row, organization) })
  } catch (error) {
    next(error)
  }
})

router.patch('/', async (req, res, next) => {
  try {
    requireAnyRole(req, MANAGEMENT_ROLES)
    const organizationId = organizationIdOf(req)
    const current = await prisma.organizationBranding.findUnique({ where: { organizationId } })
    const base: BrandingRecord = { ...DEFAULT_BRANDING, ...(current || {}) }

    const theme = req.body?.theme === undefined
      ? base.theme
      : enumValue(req.body.theme, 'theme', Object.values(BrandingTheme))
    const data = {
      brandName: req.body?.brandName === undefined ? base.brandName : optionalString(req.body.brandName, 'brandName', 120),
      brandNameAr: req.body?.brandNameAr === undefined ? base.brandNameAr : optionalString(req.body.brandNameAr, 'brandNameAr', 120),
      logoUrl: req.body?.logoUrl === undefined ? base.logoUrl : safeBrandUrl(req.body.logoUrl, 'logoUrl'),
      faviconUrl: req.body?.faviconUrl === undefined ? base.faviconUrl : safeBrandUrl(req.body.faviconUrl, 'faviconUrl'),
      primaryColor: brandColor(req.body?.primaryColor, 'primaryColor', base.primaryColor),
      secondaryColor: brandColor(req.body?.secondaryColor, 'secondaryColor', base.secondaryColor),
      accentColor: brandColor(req.body?.accentColor, 'accentColor', base.accentColor),
      supportEmail: req.body?.supportEmail === undefined
        ? base.supportEmail
        : optionalString(req.body.supportEmail, 'supportEmail', 254),
      supportPhone: req.body?.supportPhone === undefined ? base.supportPhone : optionalString(req.body.supportPhone, 'supportPhone', 50),
      footerText: req.body?.footerText === undefined ? base.footerText : optionalString(req.body.footerText, 'footerText', 500),
      footerTextAr: req.body?.footerTextAr === undefined ? base.footerTextAr : optionalString(req.body.footerTextAr, 'footerTextAr', 500),
      theme,
      isActive: req.body?.isActive === undefined ? base.isActive : booleanValue(req.body.isActive, 'isActive', true)
    }
    if (data.supportEmail && !/^\S+@\S+\.\S+$/.test(data.supportEmail)) {
      throw createError('supportEmail must be a valid email', 400)
    }

    const row = await prisma.$transaction(async (tx) => {
      const saved = await tx.organizationBranding.upsert({
        where: { organizationId },
        create: { organizationId, ...data },
        update: data
      })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'BRANDING_UPDATED',
        entityType: 'OrganizationBranding',
        entityId: saved.id,
        details: { theme: data.theme, isActive: data.isActive }
      })
      return saved
    })

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, logoUrl: true, email: true, phone: true }
    })
    if (!organization) throw createError('Organization not found', 404)
    res.json({ success: true, data: brandingResponse(row, organization), message: 'Branding saved successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return next(createError('Organization not found', 404))
    }
    next(error)
  }
})

export default router
