import { Router } from 'express'
import crypto from 'node:crypto'
import { DealStatus, DealType, PaymentStatus, Prisma, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { FINANCE_ROLES, leadScope, MANAGEMENT_ROLES, organizationIdOf, roleOf, userIdOf } from '../utils/scope'
import { booleanValue, dateValue, enumValue, numberValue, optionalString, pagination, requiredString } from '../utils/validation'
import { convertToBase, parseMoney } from '../utils/money'
import { logAudit, logPropertyActivity } from '../utils/audit'
import { assertDealTransition, assertInitialDealStatus } from '../utils/dealStatus'
import { listEntityActivity } from '../services/activity'
import { notifyUsers, organizationRecipientIds } from '../services/notifications'
import { dispatchWebhookEvent } from '../services/webhookDispatcher'
import { nullableDateValue } from '../utils/followUps'
import { buildInstallmentSchedule, installmentPaymentReferences, type InstallmentFrequency } from '../utils/installmentSchedule'
import { dealVisibility, teamVisibility } from '../utils/visibility'
import { assertHierarchyRefs } from '../utils/hierarchy'
import {
  assertValidLease,
  daysUntilLeaseEnd,
  isLeaseRenewalDue,
  leaseRenewalState,
  DEFAULT_RENEWAL_NOTICE_DAYS,
  MAX_RENEWAL_NOTICE_DAYS
} from '../utils/leases'
import {
  checklistProgress,
  ensureClosingChecklist,
  isClosingChecklistItemKey
} from '../utils/dealChecklist'

function leaseNoticeValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return numberValue(value, 'renewalNoticeDays', { min: 0, max: MAX_RENEWAL_NOTICE_DAYS })
}

const router = Router()
router.use(authMiddleware)

async function baseCurrencyOf(organizationId: string): Promise<string> {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { baseCurrency: true, currency: true }
  })
  if (!organization) throw createError('Organization not found', 404)
  return organization.baseCurrency || organization.currency || 'USD'
}

async function assertDealRelations(propertyId: string, userId: string, leadId: string | undefined, organizationId: string) {
  const [property, user, lead] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId, organizationId, deletedAt: null }, select: { id: true } }),
    prisma.user.findFirst({ where: { id: userId, organizationId, deletedAt: null }, select: { id: true } }),
    leadId
      ? prisma.lead.findFirst({
          where: {
            id: leadId,
            deletedAt: null,
            // Every existing relation must resolve inside the caller's organization;
            // a weak OR here would let a mixed lead leak across tenants.
            ...leadScope(organizationId)
          },
          select: { id: true }
        })
      : Promise.resolve(null)
  ])
  if (!property) throw createError('Property not found', 404)
  if (!user) throw createError('Responsible employee not found', 404)
  if (leadId && !lead) throw createError('Lead not found', 404)
}

function canViewAllDeals(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'ACCOUNTANT' || role === Role.TEAM_LEAD
}

// Management may write any deal; agents may write only deals assigned to them.
// Finance-only roles (ACCOUNTANT) can view deals but must not change commercial
// terms, ownership, or lifecycle status.
function canManageDeals(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'AGENT' || role === Role.TEAM_LEAD
}

router.get('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where: Prisma.DealWhereInput = { organizationId, deletedAt: null }
    if (req.query.status) where.status = enumValue(req.query.status, 'status', Object.values(DealStatus))
    if (req.query.type) where.type = enumValue(req.query.type, 'type', Object.values(DealType))
    if (req.query.propertyId) where.propertyId = String(req.query.propertyId)
    if (req.query.userId) where.userId = String(req.query.userId)
    if (!canViewAllDeals(req.user?.role)) where.userId = userIdOf(req)
    const visibilityContext = await teamVisibility(req)
    if (visibilityContext) {
      const clause = dealVisibility(visibilityContext)
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), clause]
    }
    if (req.query.search) {
      const search = String(req.query.search)
      where.OR = [
        { referenceNumber: { contains: search, mode: 'insensitive' } },
        { property: { title: { contains: search, mode: 'insensitive' } } },
        { notes: { contains: search, mode: 'insensitive' } }
      ]
    }
    if (req.query.from || req.query.to) {
      where.createdAt = {
        ...(req.query.from ? { gte: dateValue(req.query.from, 'from', true)! } : {}),
        ...(req.query.to ? { lte: dateValue(req.query.to, 'to', true)! } : {})
      }
    }
    const sort = req.query.sort === 'amount_desc' ? { amount: 'desc' as const }
      : req.query.sort === 'amount_asc' ? { amount: 'asc' as const }
      : { createdAt: 'desc' as const }

    const [total, deals] = await Promise.all([
      prisma.deal.count({ where }),
      prisma.deal.findMany({
        where,
        skip,
        take: limit,
        orderBy: sort,
        include: {
          property: { select: { id: true, title: true, referenceNumber: true, city: true } },
          user: { select: { id: true, email: true, firstName: true } },
          lead: { select: { id: true, firstName: true, lastName: true } },
          closingChecklist: {
            select: { itemKey: true, isCompleted: true },
            orderBy: { createdAt: 'asc' }
          },
          _count: { select: { payments: true, commissions: true, closingChecklist: true } }
        }
      })
    ])
    res.json({ success: true, data: deals, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error) {
    next(error)
  }
})

// Rental renewals due inside each deal's own notice window (plus expired
// leases). Uses the same state helper as the reminder service so the dashboard
// and notifications never disagree.
router.get('/lease-renewals', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const where: Prisma.DealWhereInput = {
      organizationId,
      deletedAt: null,
      isActive: true,
      type: DealType.RENT,
      status: { in: [DealStatus.PENDING, DealStatus.ACTIVE] },
      leaseEndAt: { not: null }
    }
    if (!canViewAllDeals(req.user?.role)) where.userId = userIdOf(req)
    const visibilityContext = await teamVisibility(req)
    if (visibilityContext) {
      const clause = dealVisibility(visibilityContext)
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), clause]
    }

    const now = new Date()
    const deals = await prisma.deal.findMany({
      where,
      take: 500,
      orderBy: { leaseEndAt: 'asc' },
      select: {
        id: true,
        referenceNumber: true,
        leaseEndAt: true,
        renewalNoticeDays: true,
        property: { select: { id: true, title: true, city: true } }
      }
    })
    const data = deals
      .filter((deal) => isLeaseRenewalDue(deal, now))
      .map((deal) => ({
        id: deal.id,
        referenceNumber: deal.referenceNumber,
        leaseEndAt: deal.leaseEndAt,
        noticeDays: deal.renewalNoticeDays ?? DEFAULT_RENEWAL_NOTICE_DAYS,
        daysUntil: daysUntilLeaseEnd(deal.leaseEndAt!, now),
        state: leaseRenewalState(deal, now),
        property: deal.property
      }))
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// Package 16: every deal has a standard closing checklist. Rows are created
// on first access so deals created before this feature get the same guardrail.
router.get('/:id/checklist', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const where: Prisma.DealWhereInput = { id, organizationId, deletedAt: null }
    const visibilityContext = await teamVisibility(req)
    if (visibilityContext) {
      const clause = dealVisibility(visibilityContext)
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), clause]
    }
    const deal = await prisma.deal.findFirst({
      where,
      select: { id: true, organizationId: true, userId: true }
    })
    if (!deal) throw createError('Deal not found', 404)
    if (!canViewAllDeals(req.user?.role) && deal.userId !== userIdOf(req)) {
      throw createError('Insufficient permissions to view this deal', 403)
    }
    await ensureClosingChecklist(prisma, deal)
    const items = await prisma.dealClosingChecklist.findMany({
      where: { dealId: id, organizationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, itemKey: true, label: true, isCompleted: true, completedAt: true, completedById: true }
    })
    res.json({ success: true, data: checklistProgress(items) })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/checklist/:itemKey', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const itemKey = String(req.params.itemKey)
    if (!isClosingChecklistItemKey(itemKey)) {
      throw createError(`Checklist item must be one of: ${['PAYMENT_SETTLED', 'DOCUMENTS_COMPLETE', 'CONTRACT_SIGNED', 'HANDOVER_CONFIRMED'].join(', ')}`, 400)
    }
    if (req.body?.completed === undefined) throw createError('completed is required', 400)
    const completed = booleanValue(req.body.completed, 'completed', false)

    const deal = await prisma.deal.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true, organizationId: true, userId: true }
    })
    if (!deal) throw createError('Deal not found', 404)
    if (!canManageDeals(req.user?.role)) throw createError('Insufficient permissions to update this deal', 403)
    if (req.user?.role === Role.AGENT && deal.userId !== userId) {
      throw createError('Insufficient permissions to update this deal', 403)
    }

    await ensureClosingChecklist(prisma, deal)
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.dealClosingChecklist.update({
        where: { dealId_itemKey: { dealId: id, itemKey } },
        data: {
          isCompleted: completed,
          completedAt: completed ? new Date() : null,
          completedById: completed ? userId : null
        },
        select: { id: true, itemKey: true, label: true, isCompleted: true, completedAt: true, completedById: true }
      })
      await logAudit(tx, {
        userId,
        action: 'DEAL_CHECKLIST_UPDATED',
        entityType: 'Deal',
        entityId: id,
        details: { itemKey, completed }
      })
      const items = await tx.dealClosingChecklist.findMany({
        where: { dealId: id, organizationId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, itemKey: true, label: true, isCompleted: true, completedAt: true, completedById: true }
      })
      return { row, progress: checklistProgress(items) }
    })
    res.json({ success: true, data: updated, message: 'Checklist updated' })
  } catch (error) {
    next(error)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const dealWhere: Prisma.DealWhereInput = { id, organizationId, deletedAt: null }
    const visibilityContext = await teamVisibility(req)
    if (visibilityContext) {
      const clause = dealVisibility(visibilityContext)
      dealWhere.AND = [...(Array.isArray(dealWhere.AND) ? dealWhere.AND : dealWhere.AND ? [dealWhere.AND] : []), clause]
    }
    const existing = await prisma.deal.findFirst({
      where: dealWhere,
      select: { id: true, organizationId: true, userId: true }
    })
    if (!existing) throw createError('Deal not found', 404)
    await ensureClosingChecklist(prisma, existing)
    const deal = await prisma.deal.findFirst({
      where: dealWhere,
      include: {
        property: {
          include: {
            owner: true,
            images: { where: { isPrimary: true } },
            linkedDocuments: { where: { status: 'ACTIVE', deletedAt: null } }
          }
        },
        user: { select: { id: true, email: true, firstName: true, role: true } },
        lead: true,
        payments: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        commissions: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        documents: { where: { status: 'ACTIVE', deletedAt: null } },
        expenses: { where: { deletedAt: null } },
        closingChecklist: { orderBy: { createdAt: 'asc' } }
      }
    })
    if (!deal) throw createError('Deal not found', 404)
    if (!canViewAllDeals(req.user?.role) && deal.userId !== userIdOf(req)) {
      throw createError('Insufficient permissions to view this deal', 403)
    }
    // Reuse the activity service's access checks: only audit rows for this
    // organization's deal, written by an actor in the same organization, are returned.
    const auditTrail = (await listEntityActivity(
      { id: userIdOf(req), role: req.user!.role, organizationId },
      'Deal',
      id,
      {},
      { page: 1, limit: 50, skip: 0 }
    )).data
    const visibleDeal = canViewAllDeals(req.user?.role)
      ? deal
      : { ...deal, payments: undefined, commissions: undefined, expenses: undefined }
    res.json({ success: true, data: { ...visibleDeal, auditTrail } })
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    if (!canManageDeals(req.user?.role)) throw createError('Insufficient permissions to manage deals', 403)
    const propertyId = requiredString(req.body?.propertyId, 'propertyId', 100)
    const responsibleId = optionalString(req.body?.userId, 'userId', 100) || userId
    const leadId = optionalString(req.body?.leadId, 'leadId', 100)
    const branchId = optionalString(req.body?.branchId, 'branchId', 100)
    const teamId = optionalString(req.body?.teamId, 'teamId', 100)
    await assertDealRelations(propertyId, responsibleId, leadId, organizationId)
    await assertHierarchyRefs(organizationId, branchId, teamId)

    const amount = parseMoney(req.body?.amount, 'amount', { required: true, min: 0 })!
    const currency = (optionalString(req.body?.currency, 'currency', 3) || 'USD').toUpperCase()
    const conversion = convertToBase(amount, currency, await baseCurrencyOf(organizationId), req.body?.exchangeRate)
    const status = enumValue(req.body?.status, 'status', Object.values(DealStatus), DealStatus.DRAFT)
    assertInitialDealStatus(status)
    const leaseStartAt = nullableDateValue(req.body?.leaseStartAt, 'leaseStartAt')
    const leaseEndAt = nullableDateValue(req.body?.leaseEndAt, 'leaseEndAt')
    const renewalNoticeDays = leaseNoticeValue(req.body?.renewalNoticeDays)
    assertValidLease({ leaseStartAt, leaseEndAt, renewalNoticeDays })
    if (req.user?.role === 'AGENT' && responsibleId !== userId) {
      throw createError('Agents can only create deals assigned to themselves', 403)
    }

    const deal = await prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: {
          referenceNumber: optionalString(req.body?.referenceNumber, 'referenceNumber', 100) || `DEAL-${Date.now().toString(36).toUpperCase()}`,
          type: enumValue(req.body?.type, 'type', Object.values(DealType), DealType.SALE),
          status,
          propertyId,
          leadId,
          organizationId,
          userId: responsibleId,
          branchId,
          teamId,
          amount,
          currency,
          exchangeRate: conversion.exchangeRate,
          baseAmount: conversion.baseAmount,
          startedAt: dateValue(req.body?.startedAt, 'startedAt'),
          dueAt: dateValue(req.body?.dueAt, 'dueAt'),
          // Only a completed deal may carry a close date; creation can never
          // jump directly to a terminal stage.
          closedAt: null,
          leaseStartAt,
          leaseEndAt,
          ...(renewalNoticeDays !== undefined ? { renewalNoticeDays } : {}),
          notes: optionalString(req.body?.notes, 'notes', 5000)
        }
      })
      await ensureClosingChecklist(tx, created)
      await logAudit(tx, { userId, action: 'DEAL_CREATED', entityType: 'Deal', entityId: created.id, details: { amount, currency, baseAmount: conversion.baseAmount, status, propertyId } })
      await logPropertyActivity(tx, {
        propertyId,
        userId,
        action: 'DEAL_LINKED',
        details: { dealId: created.id, status }
      })
      const recipients = await organizationRecipientIds(tx, organizationId, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: [responsibleId],
        excludeUserId: userId
      })
      await notifyUsers(tx, recipients, {
        organizationId,
        type: 'DEAL_CREATED',
        title: 'New deal created',
        message: `${created.referenceNumber || 'Deal'} was created with status ${created.status}.`,
        entityType: 'Deal',
        entityId: created.id,
        actionUrl: `/deals/${created.id}`,
        metadata: { status: created.status, amount, currency, propertyId, responsibleId }
      })
      return created
    })
    res.status(201).json({ success: true, data: deal, message: 'Deal created successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A deal with this reference number already exists', 409))
    }
    next(error)
  }
})

/**
 * Schedules a batch of pending installment payments for a deal. Reusing a
 * batchKey is idempotent: existing active scheduled payments are returned
 * instead of being duplicated.
 */
router.post('/:id/installments', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const deal = await prisma.deal.findFirst({ where: { id, organizationId, deletedAt: null } })
    if (!deal) throw createError('Deal not found', 404)

    const role = roleOf(req)
    const isFinance = role !== undefined && FINANCE_ROLES.includes(role)
    if (!isFinance && deal.userId !== userId) {
      throw createError('Insufficient permissions to manage installments for this deal', 403)
    }
    if (deal.status === DealStatus.CANCELLED) {
      throw createError('Cannot schedule installments for a cancelled deal', 400)
    }

    const body = req.body as Record<string, unknown>
    for (const key of ['downPayment', 'installmentCount', 'frequency', 'firstDueDate']) {
      if (body[key] === undefined || body[key] === null || body[key] === '') {
        throw createError(`${key} is required`, 400)
      }
    }
    const currency = optionalString(body.currency, 'currency', 3)?.toUpperCase()
    if (currency && (!/^[A-Z]{3}$/.test(currency) || currency !== deal.currency.toUpperCase())) {
      throw createError('currency must be a 3-letter code matching the deal currency', 400)
    }
    const requestedKey = optionalString(body.batchKey, 'batchKey', 100)
    const batchKey = requestedKey
      ? requestedKey.replace(/[^A-Za-z0-9_-]/g, '')
      : crypto.randomUUID()
    if (!batchKey) throw createError('batchKey must contain at least one valid character', 400)

    const schedule = buildInstallmentSchedule({
      dealAmount: deal.amount.toString(),
      downPayment: body.downPayment,
      installmentCount: body.installmentCount,
      frequency: body.frequency as InstallmentFrequency,
      firstDueDate: body.firstDueDate
    })

    const prefix = `INST-${batchKey}-`
    const existing = await prisma.payment.findMany({
      where: { dealId: id, reference: { startsWith: prefix }, deletedAt: null },
      orderBy: { dueAt: 'asc' },
      take: 1,
      select: { id: true }
    })
    if (existing.length > 0) {
      return res.json({
        success: true,
        data: { ...schedule, batchKey, payments: existing },
        message: 'Installment schedule already exists'
      })
    }

    const references = installmentPaymentReferences(batchKey, schedule.installmentCount)
    const baseCurrency = await baseCurrencyOf(organizationId)
    const payments = await prisma.$transaction(async (tx) => {
      const created: Array<Awaited<ReturnType<typeof prisma.payment.create>>> = []
      for (const row of schedule.installments) {
        const conversion = convertToBase(row.amount, deal.currency, baseCurrency, 1)
        const payment = await tx.payment.create({
          data: {
            dealId: id,
            amount: row.amount,
            currency: deal.currency,
            baseAmount: conversion.baseAmount,
            exchangeRate: conversion.exchangeRate,
            status: PaymentStatus.PENDING,
            reference: references[row.index - 1],
            idempotencyKey: `INSTALLMENT-${batchKey}-${row.index}`,
            dueAt: new Date(row.dueAt),
            paidAt: null,
            createdById: userId,
            notes: `Scheduled installment ${row.index}`
          }
        })
        created.push(payment)
      }
      await logAudit(tx, {
        userId,
        action: 'DEAL_INSTALLMENTS_SCHEDULED',
        entityType: 'Deal',
        entityId: id,
        details: { batchKey, count: created.length, total: schedule.total }
      })
      return created
    })
    res.json({
      success: true,
      data: { ...schedule, batchKey, payments },
      message: 'Installment schedule created'
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('An installment with this reference already exists', 409))
    }
    next(error)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.deal.findFirst({ where: { id, organizationId, deletedAt: null } })
    if (!existing) throw createError('Deal not found', 404)
    if (!canManageDeals(req.user?.role)) {
      throw createError('Insufficient permissions to update this deal', 403)
    }
    if (req.user?.role === 'AGENT' && existing.userId !== userId) {
      throw createError('Insufficient permissions to update this deal', 403)
    }

    const body = req.body as Record<string, unknown>
    const nextStatus = body.status !== undefined
      ? enumValue(body.status, 'status', Object.values(DealStatus))
      : existing.status
    assertDealTransition(existing.status, nextStatus)
    // Package 22: hoisted so the webhook can only fire after the transaction
    // that actually committed the stage change.
    const stageChanged = nextStatus !== existing.status
    if (body.closedAt !== undefined && nextStatus !== DealStatus.COMPLETED) {
      throw createError('closedAt can only be set when completing a deal', 400)
    }
    const leaseStartAt = body.leaseStartAt === undefined
      ? existing.leaseStartAt
      : nullableDateValue(body.leaseStartAt, 'leaseStartAt')
    const leaseEndAt = body.leaseEndAt === undefined
      ? existing.leaseEndAt
      : nullableDateValue(body.leaseEndAt, 'leaseEndAt')
    const renewalNoticeDays = body.renewalNoticeDays === undefined
      ? existing.renewalNoticeDays
      : (leaseNoticeValue(body.renewalNoticeDays) ?? DEFAULT_RENEWAL_NOTICE_DAYS)
    assertValidLease({ leaseStartAt, leaseEndAt, renewalNoticeDays })

    const data: Prisma.DealUpdateInput = {}
    const completing = nextStatus === DealStatus.COMPLETED && existing.status !== DealStatus.COMPLETED
    let checklistOverride: { reason: string; by: string; at: Date } | undefined
    if (completing) {
      await ensureClosingChecklist(prisma, existing)
      const checklistItems = await prisma.dealClosingChecklist.findMany({
        where: { dealId: id, organizationId },
        select: { id: true, itemKey: true, label: true, isCompleted: true, completedAt: true, completedById: true }
      })
      if (!checklistProgress(checklistItems).isComplete) {
        const reason = optionalString(body.checklistOverrideReason, 'checklistOverrideReason', 1000)
        if (!reason) {
          throw createError('All closing checklist items must be completed, or provide checklistOverrideReason', 400)
        }
        const role = roleOf(req)
        if (!role || !MANAGEMENT_ROLES.includes(role)) {
          throw createError('Only ADMIN or MANAGER can override the closing checklist', 403)
        }
        checklistOverride = { reason, by: userId, at: new Date() }
        data.checklistOverrideReason = reason
        data.checklistOverriddenById = userId
        data.checklistOverriddenAt = checklistOverride.at
      }
    }
    if (body.status !== undefined) data.status = nextStatus
    if (body.type !== undefined) data.type = enumValue(body.type, 'type', Object.values(DealType))
    if (body.notes !== undefined) data.notes = optionalString(body.notes, 'notes', 5000)
    if (body.startedAt !== undefined) data.startedAt = dateValue(body.startedAt, 'startedAt')
    if (body.dueAt !== undefined) data.dueAt = dateValue(body.dueAt, 'dueAt')
    if (body.closedAt !== undefined) data.closedAt = dateValue(body.closedAt, 'closedAt')
    if (body.leaseStartAt !== undefined) data.leaseStartAt = leaseStartAt
    if (body.leaseEndAt !== undefined) data.leaseEndAt = leaseEndAt
    if (body.renewalNoticeDays !== undefined) data.renewalNoticeDays = renewalNoticeDays
    if (nextStatus === DealStatus.COMPLETED && !existing.closedAt) data.closedAt = new Date()

    let amount = existing.amount.toString()
    let currency = existing.currency
    let rate: unknown = body.exchangeRate !== undefined ? body.exchangeRate : existing.exchangeRate?.toString()
    let conversion: { baseAmount: string; exchangeRate: string } | undefined
    if (body.amount !== undefined) amount = parseMoney(body.amount, 'amount', { required: true, min: 0 })!
    if (body.currency !== undefined) currency = (optionalString(body.currency, 'currency', 3) || currency).toUpperCase()
    if (body.amount !== undefined || body.currency !== undefined || body.exchangeRate !== undefined) {
      conversion = convertToBase(amount, currency, await baseCurrencyOf(organizationId), rate)
      data.amount = amount
      data.currency = currency
      data.exchangeRate = conversion.exchangeRate
      data.baseAmount = conversion.baseAmount
    }

    if (body.propertyId !== undefined || body.userId !== undefined || body.leadId !== undefined) {
      const propertyId = body.propertyId === undefined ? existing.propertyId : requiredString(body.propertyId, 'propertyId', 100)
      const responsibleId = body.userId === undefined ? existing.userId : requiredString(body.userId, 'userId', 100)
      const leadId = (body.leadId === undefined ? existing.leadId : optionalString(body.leadId, 'leadId', 100)) ?? undefined
      if (req.user?.role === 'AGENT' && responsibleId !== userId) {
        throw createError('Agents cannot reassign deals to other employees', 403)
      }
      await assertDealRelations(propertyId, responsibleId, leadId, organizationId)
      data.property = { connect: { id: propertyId } }
      data.user = { connect: { id: responsibleId } }
      data.lead = leadId ? { connect: { id: leadId } } : { disconnect: true }
    }

    const deal = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction so two concurrent PATCHes cannot both
      // apply the same stage change and emit duplicate notifications.
      const current = await tx.deal.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { status: true }
      })
      if (!current) throw createError('Deal not found', 404)
      if (current.status !== existing.status) {
        throw createError('Deal was updated concurrently; please retry', 409)
      }

      const updated = await tx.deal.update({ where: { id }, data })
      await logAudit(tx, {
        userId,
        action: stageChanged ? 'DEAL_STATUS_CHANGED' : 'DEAL_UPDATED',
        entityType: 'Deal',
        entityId: id,
        details: {
          before: existing.status,
          after: nextStatus,
          fields: Object.keys(data),
          baseAmount: conversion?.baseAmount,
          ...(checklistOverride ? { checklistOverride: checklistOverride.reason } : {})
        }
      })
      if (stageChanged) {
        await logPropertyActivity(tx, {
          propertyId: updated.propertyId,
          userId,
          action: 'DEAL_STATUS_CHANGED',
          details: { dealId: id, before: existing.status, after: nextStatus }
        })
      }
      const responsibleChanged = updated.userId !== existing.userId
      const recipients = await organizationRecipientIds(tx, organizationId, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: [updated.userId, existing.userId],
        excludeUserId: userId
      })
      // notifyUsers deduplicates recipients, and the stage transition is included
      // in the notification key so distinct stages never collapse into one event.
      if (recipients.length) {
        await notifyUsers(tx, recipients, {
          organizationId,
          type: stageChanged ? 'DEAL_STATUS_CHANGED' : responsibleChanged ? 'DEAL_ASSIGNED' : 'DEAL_UPDATED',
          title: stageChanged ? 'Deal status updated' : responsibleChanged ? 'Deal reassigned' : 'Deal updated',
          message: `${updated.referenceNumber || 'Deal'} ${stageChanged ? `changed from ${existing.status} to ${nextStatus}` : responsibleChanged ? 'was reassigned' : 'was updated'}.`,
          entityType: 'Deal',
          entityId: id,
          actionUrl: `/deals/${id}`,
          metadata: {
            beforeStatus: existing.status,
            afterStatus: nextStatus,
            transition: `${existing.status}->${nextStatus}`,
            beforeUserId: existing.userId,
            afterUserId: updated.userId
          }
        })
      }
      return updated
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    if (stageChanged) {
      await dispatchWebhookEvent({
        organizationId,
        event: 'deal.stage_changed',
        entityId: deal.id,
        actorUserId: userId,
        data: {
          id: deal.id,
          referenceNumber: deal.referenceNumber,
          propertyId: deal.propertyId,
          from: existing.status,
          to: deal.status,
          status: deal.status,
          amount: deal.amount.toString(),
          currency: deal.currency
        }
      })
    }
    res.json({ success: true, data: deal, message: 'Deal updated successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return next(createError('Deal was updated concurrently; please retry', 409))
    }
    next(error)
  }
})

router.delete('/:id', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.deal.findFirst({ where: { id, organizationId, deletedAt: null } })
    if (!existing) throw createError('Deal not found', 404)
    const hasPayments = await prisma.payment.count({ where: { dealId: id, deletedAt: null } })
    if (hasPayments > 0) throw createError('Deals with recorded payments cannot be archived; cancel the deal instead', 400)

    await prisma.$transaction(async (tx) => {
      await tx.deal.update({ where: { id }, data: { isActive: false, deletedAt: new Date(), status: DealStatus.CANCELLED } })
      await logAudit(tx, { userId, action: 'DEAL_ARCHIVED', entityType: 'Deal', entityId: id })
      await logPropertyActivity(tx, { propertyId: existing.propertyId, userId, action: 'DEAL_ARCHIVED', details: { dealId: id } })
      const recipients = await organizationRecipientIds(tx, organizationId, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: [existing.userId],
        excludeUserId: userId
      })
      await notifyUsers(tx, recipients, {
        organizationId,
        type: 'DEAL_ARCHIVED',
        title: 'Deal archived',
        message: `${existing.referenceNumber || 'Deal'} was archived.`,
        entityType: 'Deal',
        entityId: id,
        actionUrl: `/deals/${id}`,
        metadata: { previousStatus: existing.status }
      })
    })
    res.json({ success: true, message: 'Deal archived successfully' })
  } catch (error) {
    next(error)
  }
})

export default router
