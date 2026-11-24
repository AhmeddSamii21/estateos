import { Router } from 'express'
import { ContractTemplateLanguage, Prisma, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { logAudit } from '../utils/audit'
import { buildContractPreview } from '../utils/contractRendering'
import { MANAGEMENT_ROLES, organizationIdOf, requireAnyRole, roleOf, userIdOf } from '../utils/scope'
import { booleanValue, numberValue, optionalString, pagination, requiredString } from '../utils/validation'

const router = Router()
router.use(authMiddleware)

function templatePayload(template: {
  id: string
  organizationId: string
  name: string
  nameAr: string | null
  language: ContractTemplateLanguage
  body: string
  bodyAr: string | null
  version: number
  isActive: boolean
}) {
  return {
    id: template.id,
    organizationId: template.organizationId,
    name: template.name,
    nameAr: template.nameAr,
    language: template.language,
    body: template.body,
    bodyAr: template.bodyAr,
    version: template.version,
    isActive: template.isActive
  }
}

router.get('/templates', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where: Prisma.ContractTemplateWhereInput = { organizationId, deletedAt: null }
    if (req.query.isActive !== undefined) where.isActive = booleanValue(req.query.isActive, 'isActive')
    const [total, templates] = await Promise.all([
      prisma.contractTemplate.count({ where }),
      prisma.contractTemplate.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } })
    ])
    res.json({
      success: true,
      data: templates.map(templatePayload),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    next(error)
  }
})

router.post('/templates', async (req, res, next) => {
  try {
    requireAnyRole(req, MANAGEMENT_ROLES)
    const organizationId = organizationIdOf(req)
    const language = (req.body?.language ?? ContractTemplateLanguage.BILINGUAL) as ContractTemplateLanguage
    if (!Object.values(ContractTemplateLanguage).includes(language)) {
      throw createError('language must be one of EN, AR, BILINGUAL', 400)
    }
    const template = await prisma.contractTemplate.create({
      data: {
        organizationId,
        name: requiredString(req.body?.name, 'name', 120),
        nameAr: optionalString(req.body?.nameAr, 'nameAr', 120),
        language,
        body: requiredString(req.body?.body, 'body', 12000),
        bodyAr: optionalString(req.body?.bodyAr, 'bodyAr', 12000),
        version: numberValue(req.body?.version, 'version', { min: 1, max: 999 }) ?? 1,
        isActive: booleanValue(req.body?.isActive, 'isActive', true)
      }
    })
    await logAudit(prisma, {
      userId: userIdOf(req),
      action: 'CONTRACT_TEMPLATE_CREATED',
      entityType: 'ContractTemplate',
      entityId: template.id,
      details: { language: template.language, version: template.version }
    })
    res.status(201).json({ success: true, data: templatePayload(template), message: 'Contract template created' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A contract template with this name already exists', 409))
    }
    next(error)
  }
})

router.patch('/templates/:id', async (req, res, next) => {
  try {
    requireAnyRole(req, MANAGEMENT_ROLES)
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.contractTemplate.findFirst({ where: { id, organizationId, deletedAt: null } })
    if (!existing) throw createError('Contract template not found', 404)

    const data: Prisma.ContractTemplateUpdateInput = {}
    if (req.body?.name !== undefined) data.name = requiredString(req.body.name, 'name', 120)
    if (req.body?.nameAr !== undefined) data.nameAr = optionalString(req.body.nameAr, 'nameAr', 120)
    if (req.body?.language !== undefined) {
      const language = req.body.language as ContractTemplateLanguage
      if (!Object.values(ContractTemplateLanguage).includes(language)) {
        throw createError('language must be one of EN, AR, BILINGUAL', 400)
      }
      data.language = language
    }
    if (req.body?.body !== undefined) data.body = requiredString(req.body.body, 'body', 12000)
    if (req.body?.bodyAr !== undefined) data.bodyAr = optionalString(req.body.bodyAr, 'bodyAr', 12000)
    if (req.body?.version !== undefined) data.version = numberValue(req.body.version, 'version', { required: true, min: 1, max: 999 })!
    if (req.body?.isActive !== undefined) data.isActive = booleanValue(req.body.isActive, 'isActive')
    // Body changes create a new immutable version from the UI's perspective.
    if (req.body?.body !== undefined || req.body?.bodyAr !== undefined) {
      data.version = existing.version + 1
    }

    const template = await prisma.contractTemplate.update({ where: { id }, data })
    await logAudit(prisma, {
      userId: userIdOf(req),
      action: 'CONTRACT_TEMPLATE_UPDATED',
      entityType: 'ContractTemplate',
      entityId: id,
      details: { fromVersion: existing.version, toVersion: template.version }
    })
    res.json({ success: true, data: templatePayload(template), message: 'Contract template updated' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A contract template with this name already exists', 409))
    }
    next(error)
  }
})

router.post('/templates/:id/render', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const template = await prisma.contractTemplate.findFirst({ where: { id, organizationId, deletedAt: null, isActive: true } })
    if (!template) throw createError('Contract template not found', 404)

    const dealId = requiredString(req.body?.dealId, 'dealId', 100)
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, organizationId, deletedAt: null },
      include: {
        property: { select: { title: true, city: true, area: true } },
        lead: { select: { firstName: true, lastName: true } },
        user: { select: { firstName: true, email: true } },
        organization: { select: { name: true } }
      }
    })
    if (!deal) throw createError('Deal not found', 404)
    if (roleOf(req) === Role.AGENT && deal.userId !== userIdOf(req)) {
      throw createError('Agents may only preview contracts for their own deals', 403)
    }

    const language = req.body?.language === 'ar' ? 'ar' : 'en'
    const values = {
      client_name: [deal.lead?.firstName, deal.lead?.lastName].filter(Boolean).join(' ').trim() || '—',
      property_title: deal.property?.title || '—',
      property_city: deal.property?.city || '—',
      property_area: deal.property?.area == null ? '—' : deal.property.area.toFixed(2),
      deal_reference: deal.referenceNumber || deal.id,
      deal_amount: deal.amount.toFixed(2),
      deal_currency: deal.currency,
      agent_name: deal.user?.firstName || deal.user?.email || '—',
      organization_name: deal.organization?.name || 'EstateOS',
      today: new Date().toISOString().slice(0, 10)
    }

    const preview = buildContractPreview(template, values, language)
    res.json({ success: true, data: { ...preview, dealId, templateId: template.id, version: template.version } })
  } catch (error) {
    next(error)
  }
})

export default router
