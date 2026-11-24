import { Router } from 'express'
import { Prisma, ReferralSplitStatus, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { logAudit } from '../utils/audit'
import { MANAGEMENT_ROLES, organizationIdOf, requireAnyRole, roleOf, userIdOf } from '../utils/scope'
import { booleanValue, enumValue, numberValue, optionalString, pagination, requiredString } from '../utils/validation'

const router = Router()
router.use(authMiddleware)

const SPLIT_WRITE_ROLES = [...MANAGEMENT_ROLES, Role.TEAM_LEAD, Role.AGENT]
const SPLIT_APPROVE_ROLES = [...MANAGEMENT_ROLES, Role.TEAM_LEAD]

const SPLIT_TRANSITIONS: Record<ReferralSplitStatus, ReferralSplitStatus[]> = {
  [ReferralSplitStatus.PENDING]: [ReferralSplitStatus.APPROVED, ReferralSplitStatus.PAID, ReferralSplitStatus.CANCELLED],
  [ReferralSplitStatus.APPROVED]: [ReferralSplitStatus.PAID, ReferralSplitStatus.CANCELLED],
  [ReferralSplitStatus.PAID]: [],
  [ReferralSplitStatus.CANCELLED]: []
}

function partnerPayload(partner: {
  id: string
  organizationId: string
  name: string
  nameAr: string | null
  companyName: string | null
  email: string | null
  phone: string | null
  commissionRate: Prisma.Decimal
  notes: string | null
  isActive: boolean
}) {
  return {
    id: partner.id,
    organizationId: partner.organizationId,
    name: partner.name,
    nameAr: partner.nameAr,
    companyName: partner.companyName,
    email: partner.email,
    phone: partner.phone,
    commissionRate: partner.commissionRate.toFixed(2),
    notes: partner.notes,
    isActive: partner.isActive
  }
}

function splitPayload(split: {
  id: string
  organizationId: string
  dealId: string
  partnerId: string
  rate: Prisma.Decimal
  amount: Prisma.Decimal
  currency: string
  status: ReferralSplitStatus
  notes: string | null
  approvedAt: Date | null
  paidAt: Date | null
  partner?: { id: string; name: string; nameAr: string | null } | null
  deal?: { referenceNumber: string | null; amount: Prisma.Decimal; userId: string } | null
}) {
  return {
    id: split.id,
    organizationId: split.organizationId,
    dealId: split.dealId,
    partnerId: split.partnerId,
    rate: split.rate.toFixed(2),
    amount: split.amount.toFixed(2),
    currency: split.currency,
    status: split.status,
    notes: split.notes,
    approvedAt: split.approvedAt,
    paidAt: split.paidAt,
    partnerName: split.partner?.nameAr || split.partner?.name || null,
    dealReference: split.deal?.referenceNumber || null
  }
}

function validateEmail(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw createError('partner email is invalid', 400)
  return value
}

async function findPartner(organizationId: string, id: string) {
  const partner = await prisma.referralPartner.findFirst({ where: { id, organizationId, deletedAt: null } })
  if (!partner) throw createError('Referral partner not found', 404)
  return partner
}

async function findDeal(organizationId: string, id: string) {
  const deal = await prisma.deal.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: { id: true, referenceNumber: true, amount: true, currency: true, userId: true }
  })
  if (!deal) throw createError('Deal not found', 404)
  return deal
}

router.get('/partners', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where: Prisma.ReferralPartnerWhereInput = { organizationId, deletedAt: null }
    if (req.query.isActive !== undefined) where.isActive = booleanValue(req.query.isActive, 'isActive')
    const [total, partners] = await Promise.all([
      prisma.referralPartner.count({ where }),
      prisma.referralPartner.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } })
    ])
    res.json({
      success: true,
      data: partners.map(partnerPayload),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    next(error)
  }
})

router.post('/partners', async (req, res, next) => {
  try {
    requireAnyRole(req, MANAGEMENT_ROLES)
    const organizationId = organizationIdOf(req)
    const commissionRate = numberValue(req.body?.commissionRate, 'commissionRate', { min: 0, max: 100 }) ?? 10
    const partner = await prisma.referralPartner.create({
      data: {
        organizationId,
        name: requiredString(req.body?.name, 'name', 120),
        nameAr: optionalString(req.body?.nameAr, 'nameAr', 120),
        companyName: optionalString(req.body?.companyName, 'companyName', 160),
        email: validateEmail(optionalString(req.body?.email, 'email', 160)),
        phone: optionalString(req.body?.phone, 'phone', 40),
        commissionRate: new Prisma.Decimal(commissionRate),
        notes: optionalString(req.body?.notes, 'notes', 1000),
        isActive: booleanValue(req.body?.isActive, 'isActive', true)
      }
    })
    await logAudit(prisma, {
      userId: userIdOf(req),
      action: 'REFERRAL_PARTNER_CREATED',
      entityType: 'ReferralPartner',
      entityId: partner.id,
      details: { commissionRate: partner.commissionRate.toFixed(2) }
    })
    res.status(201).json({ success: true, data: partnerPayload(partner), message: 'Referral partner created' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A referral partner with this name already exists', 409))
    }
    next(error)
  }
})

router.patch('/partners/:id', async (req, res, next) => {
  try {
    requireAnyRole(req, MANAGEMENT_ROLES)
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    await findPartner(organizationId, id)
    const data: Prisma.ReferralPartnerUpdateInput = {}
    if (req.body?.name !== undefined) data.name = requiredString(req.body.name, 'name', 120)
    if (req.body?.nameAr !== undefined) data.nameAr = optionalString(req.body.nameAr, 'nameAr', 120)
    if (req.body?.companyName !== undefined) data.companyName = optionalString(req.body.companyName, 'companyName', 160)
    if (req.body?.email !== undefined) data.email = validateEmail(optionalString(req.body.email, 'email', 160))
    if (req.body?.phone !== undefined) data.phone = optionalString(req.body.phone, 'phone', 40)
    if (req.body?.commissionRate !== undefined) {
      const rate = numberValue(req.body.commissionRate, 'commissionRate', { required: true, min: 0, max: 100 })!
      data.commissionRate = new Prisma.Decimal(rate)
    }
    if (req.body?.notes !== undefined) data.notes = optionalString(req.body.notes, 'notes', 1000)
    if (req.body?.isActive !== undefined) data.isActive = booleanValue(req.body.isActive, 'isActive')
    const partner = await prisma.referralPartner.update({ where: { id }, data })
    await logAudit(prisma, {
      userId: userIdOf(req),
      action: 'REFERRAL_PARTNER_UPDATED',
      entityType: 'ReferralPartner',
      entityId: id
    })
    res.json({ success: true, data: partnerPayload(partner), message: 'Referral partner updated' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A referral partner with this name already exists', 409))
    }
    next(error)
  }
})

router.get('/splits', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where: Prisma.ReferralSplitWhereInput = { organizationId }
    if (req.query.status) {
      where.status = enumValue(req.query.status, 'status', Object.values(ReferralSplitStatus))
    }
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId)
    if (req.query.dealId) where.dealId = String(req.query.dealId)
    if (roleOf(req) === Role.AGENT) where.deal = { userId: userIdOf(req), deletedAt: null }
    const [total, splits] = await Promise.all([
      prisma.referralSplit.count({ where }),
      prisma.referralSplit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          partner: { select: { id: true, name: true, nameAr: true } },
          deal: { select: { referenceNumber: true, amount: true, userId: true } }
        }
      })
    ])
    res.json({
      success: true,
      data: splits.map(splitPayload),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    next(error)
  }
})

router.post('/splits', async (req, res, next) => {
  try {
    requireAnyRole(req, SPLIT_WRITE_ROLES)
    const organizationId = organizationIdOf(req)
    const dealId = requiredString(req.body?.dealId, 'dealId', 100)
    const partnerId = requiredString(req.body?.partnerId, 'partnerId', 100)
    const deal = await findDeal(organizationId, dealId)
    const partner = await findPartner(organizationId, partnerId)
    if (roleOf(req) === Role.AGENT && deal.userId !== userIdOf(req)) {
      throw createError('Agents may only record splits on their own deals', 403)
    }
    if (!partner.isActive) throw createError('Referral partner is not active', 400)

    const rate = numberValue(req.body?.rate, 'rate', { min: 0, max: 100 }) ?? Number(partner.commissionRate.toFixed(2))
    const amount = new Prisma.Decimal(deal.amount).times(rate).div(100).toDecimalPlaces(2)
    const split = await prisma.$transaction(async (tx) => {
      const created = await tx.referralSplit.create({
        data: {
          organizationId,
          dealId,
          partnerId,
          rate: new Prisma.Decimal(rate),
          amount,
          currency: optionalString(req.body?.currency, 'currency', 3)?.toUpperCase() || deal.currency,
          notes: optionalString(req.body?.notes, 'notes', 1000)
        },
        include: {
          partner: { select: { id: true, name: true, nameAr: true } },
          deal: { select: { referenceNumber: true, amount: true, userId: true } }
        }
      })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'REFERRAL_SPLIT_CREATED',
        entityType: 'ReferralSplit',
        entityId: created.id,
        details: { dealId, partnerId, rate, amount: amount.toFixed(2) }
      })
      return created
    })
    res.status(201).json({ success: true, data: splitPayload(split), message: 'Referral split recorded' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('This partner already has a split on the deal', 409))
    }
    next(error)
  }
})

router.patch('/splits/:id/status', async (req, res, next) => {
  try {
    requireAnyRole(req, SPLIT_APPROVE_ROLES)
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.referralSplit.findFirst({ where: { id, organizationId } })
    if (!existing) throw createError('Referral split not found', 404)
    const nextStatus = enumValue(req.body?.status, 'status', Object.values(ReferralSplitStatus))
    if (!SPLIT_TRANSITIONS[existing.status].includes(nextStatus)) {
      throw createError(`Cannot move a ${existing.status} split to ${nextStatus}`, 400)
    }
    const split = await prisma.$transaction(async (tx) => {
      const updated = await tx.referralSplit.update({
        where: { id },
        data: {
          status: nextStatus,
          ...(nextStatus === ReferralSplitStatus.APPROVED ? { approvedAt: new Date() } : {}),
          ...(nextStatus === ReferralSplitStatus.PAID ? { paidAt: new Date() } : {}),
          ...(req.body?.notes !== undefined ? { notes: optionalString(req.body.notes, 'notes', 1000) } : {})
        },
        include: {
          partner: { select: { id: true, name: true, nameAr: true } },
          deal: { select: { referenceNumber: true, amount: true, userId: true } }
        }
      })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'REFERRAL_SPLIT_STATUS_CHANGED',
        entityType: 'ReferralSplit',
        entityId: id,
        details: { from: existing.status, to: nextStatus }
      })
      return updated
    })
    res.json({ success: true, data: splitPayload(split), message: 'Referral split status updated' })
  } catch (error) {
    next(error)
  }
})

router.get('/summary', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const splits = await prisma.referralSplit.findMany({
      where: roleOf(req) === Role.AGENT
        ? { organizationId, deal: { userId: userIdOf(req), deletedAt: null } }
        : { organizationId },
      include: { partner: { select: { id: true, name: true, nameAr: true } } }
    })
    const byPartner = new Map<string, { partnerId: string; partnerName: string; currency: string; total: Prisma.Decimal; count: number }>()
    for (const split of splits) {
      const key = `${split.partnerId}:${split.currency}`
      const current = byPartner.get(key) || {
        partnerId: split.partnerId,
        partnerName: split.partner?.nameAr || split.partner?.name || split.partnerId,
        currency: split.currency,
        total: new Prisma.Decimal(0),
        count: 0
      }
      current.total = current.total.plus(split.amount)
      current.count += 1
      byPartner.set(key, current)
    }
    res.json({
      success: true,
      data: {
        splitCount: splits.length,
        byPartner: [...byPartner.values()].map((row) => ({
          ...row,
          total: row.total.toFixed(2)
        }))
      }
    })
  } catch (error) {
    next(error)
  }
})

export default router
