import { Router } from 'express'
import {
  CommissionStatus,
  ExpenseStatus,
  PaymentStatus,
  Prisma
} from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { FINANCE_ROLES, MANAGEMENT_ROLES, organizationIdOf, requireAnyRole, userIdOf } from '../utils/scope'
import {
  dateValue,
  enumValue,
  optionalString,
  pagination,
  requiredString
} from '../utils/validation'
import { commissionAmount, convertToBase, parseMoney, parseRate, receivedAmount } from '../utils/money'
import { logAudit } from '../utils/audit'
import { notifyUsers, organizationRecipientIds } from '../services/notifications'

const router = Router()
router.use(authMiddleware, requireRole(FINANCE_ROLES))

async function baseCurrencyOf(organizationId: string): Promise<string> {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { baseCurrency: true, currency: true }
  })
  if (!organization) throw createError('Organization not found', 404)
  return organization.baseCurrency || organization.currency || 'USD'
}

async function assertDeal(dealId: string, organizationId: string) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId, deletedAt: null },
    select: { id: true, currency: true, amount: true, baseAmount: true, userId: true, referenceNumber: true, propertyId: true }
  })
  if (!deal) throw createError('Deal not found', 404)
  return deal
}

async function assertProperty(propertyId: string, organizationId: string) {
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId, deletedAt: null },
    select: { id: true }
  })
  if (!property) throw createError('Property not found', 404)
  return property
}

async function assertUser(userId: string, organizationId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId, deletedAt: null },
    select: { id: true }
  })
  if (!user) throw createError('User not found', 404)
  return user
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

router.get('/payments', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where: Prisma.PaymentWhereInput = { deletedAt: null, deal: { organizationId } }
    if (req.query.dealId) where.dealId = String(req.query.dealId)
    if (req.query.status) where.status = enumValue(req.query.status, 'status', Object.values(PaymentStatus))
    if (req.query.from || req.query.to) {
      where.createdAt = {
        ...(req.query.from ? { gte: dateValue(req.query.from, 'from', true)! } : {}),
        ...(req.query.to ? { lte: dateValue(req.query.to, 'to', true)! } : {})
      }
    }

    const [total, payments] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { deal: { select: { id: true, referenceNumber: true, currency: true, amount: true } } }
      })
    ])
    res.json({ success: true, data: payments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error) {
    next(error)
  }
})

router.get('/payments/summary', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const dealId = requiredString(req.query.dealId, 'dealId', 100)
    const deal = await assertDeal(dealId, organizationId)
    const payments = await prisma.payment.findMany({
      where: { dealId, deletedAt: null },
      select: { amount: true, baseAmount: true, currency: true, status: true, deletedAt: true }
    })
    const received = receivedAmount(payments)
    const dealBase = deal.baseAmount?.toString() || deal.amount.toString()
    const balance = new Prisma.Decimal(dealBase).minus(received)
    const outstanding = balance.isNegative() ? '0.00' : balance.toFixed(2)
    res.json({
      success: true,
      data: {
        dealAmount: deal.amount,
        dealBaseAmount: dealBase,
        currency: deal.currency,
        received,
        outstanding,
        payments: payments.length
      }
    })
  } catch (error) {
    next(error)
  }
})

router.post('/payments', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const dealId = requiredString(req.body?.dealId, 'dealId', 100)
    const deal = await assertDeal(dealId, organizationId)
    const amount = parseMoney(req.body?.amount, 'amount', { required: true, min: 0.01 })!
    const currency = (optionalString(req.body?.currency, 'currency', 3) || deal.currency).toUpperCase()
    const baseCurrency = await baseCurrencyOf(organizationId)
    const conversion = convertToBase(amount, currency, baseCurrency, req.body?.exchangeRate)
    const status = enumValue(req.body?.status, 'status', Object.values(PaymentStatus), PaymentStatus.PENDING)
    const reference = optionalString(req.body?.reference, 'reference', 100)
    const idempotencyKey = optionalString(req.body?.idempotencyKey, 'idempotencyKey', 150)
    const paidAt = dateValue(req.body?.paidAt, 'paidAt') || (status === PaymentStatus.COMPLETED ? new Date() : undefined)

    if (reference) {
      const duplicate = await prisma.payment.findFirst({ where: { dealId, reference }, select: { id: true } })
      if (duplicate) throw createError('A payment with this reference already exists for the deal', 409)
    }

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          dealId,
          amount,
          currency,
          status,
          method: optionalString(req.body?.method, 'method', 100),
          reference,
          notes: optionalString(req.body?.notes, 'notes', 5000),
          idempotencyKey,
          exchangeRate: conversion.exchangeRate,
          baseAmount: conversion.baseAmount,
          paidAt,
          createdById: userId
        }
      })
      await logAudit(tx, {
        userId,
        action: 'PAYMENT_RECORDED',
        entityType: 'Payment',
        entityId: created.id,
        details: { dealId, amount, currency, baseAmount: conversion.baseAmount, status }
      })
      const recipients = await organizationRecipientIds(tx, organizationId, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: [deal.userId],
        excludeUserId: userId
      })
      await notifyUsers(tx, recipients, {
        organizationId,
        type: 'PAYMENT_RECORDED',
        title: 'Payment recorded',
        message: `${amount} ${currency} was recorded for ${deal.referenceNumber || 'a deal'} (${status}).`,
        entityType: 'Payment',
        entityId: created.id,
        actionUrl: `/deals/${dealId}`,
        metadata: { dealId, amount, currency, status }
      })
      return created
    })

    res.status(201).json({ success: true, data: payment, message: 'Payment recorded successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('Duplicate payment reference or idempotency key', 409))
    }
    next(error)
  }
})

router.patch('/payments/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.payment.findFirst({ where: { id, deletedAt: null, deal: { organizationId } } })
    if (!existing) throw createError('Payment not found', 404)

    const body = req.body as Record<string, unknown>
    const data: Prisma.PaymentUpdateInput = {}
    let amount = existing.amount.toString()
    let currency = existing.currency
    let rateInput: unknown = existing.exchangeRate?.toString()

    if (body.amount !== undefined) amount = parseMoney(body.amount, 'amount', { required: true, min: 0.01 })!
    if (body.currency !== undefined) currency = (optionalString(body.currency, 'currency', 3) || currency).toUpperCase()
    if (body.exchangeRate !== undefined) rateInput = body.exchangeRate
    const conversion = convertToBase(amount, currency, await baseCurrencyOf(organizationId), rateInput)
    data.amount = amount
    data.currency = currency
    data.exchangeRate = conversion.exchangeRate
    data.baseAmount = conversion.baseAmount

    if (body.status !== undefined) data.status = enumValue(body.status, 'status', Object.values(PaymentStatus))
    if (body.method !== undefined) data.method = optionalString(body.method, 'method', 100)
    if (body.reference !== undefined) data.reference = optionalString(body.reference, 'reference', 100)
    if (body.notes !== undefined) data.notes = optionalString(body.notes, 'notes', 5000)
    if (body.paidAt !== undefined) data.paidAt = dateValue(body.paidAt, 'paidAt')

    const payment = await prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({ where: { id }, data })
      await logAudit(tx, {
        userId,
        action: 'PAYMENT_UPDATED',
        entityType: 'Payment',
        entityId: id,
        details: { before: { amount: existing.amount.toString(), currency: existing.currency, status: existing.status }, after: { amount, currency, status: updated.status } }
      })
      const deal = await tx.deal.findFirst({ where: { id: existing.dealId }, select: { userId: true, referenceNumber: true } })
      const recipients = await organizationRecipientIds(tx, organizationId, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: deal?.userId ? [deal.userId] : [],
        excludeUserId: userId
      })
      if (recipients.length && (existing.status !== updated.status || existing.amount.toString() !== updated.amount.toString())) {
        await notifyUsers(tx, recipients, {
          organizationId,
          type: 'PAYMENT_UPDATED',
          title: 'Payment updated',
          message: `Payment for ${deal?.referenceNumber || 'a deal'} is now ${updated.status}.`,
          entityType: 'Payment',
          entityId: id,
          actionUrl: `/deals/${existing.dealId}`,
          metadata: { dealId: existing.dealId, beforeStatus: existing.status, afterStatus: updated.status }
        })
      }
      return updated
    })
    res.json({ success: true, data: payment, message: 'Payment updated successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('Duplicate payment reference', 409))
    }
    next(error)
  }
})

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

async function expenseScope(organizationId: string): Promise<Prisma.ExpenseWhereInput> {
  return {
    deletedAt: null,
    AND: [
      { OR: [{ property: { organizationId } }, { deal: { organizationId } }, { responsible: { organizationId } }] },
      { OR: [{ propertyId: null }, { property: { organizationId } }] },
      { OR: [{ dealId: null }, { deal: { organizationId } }] },
      { OR: [{ responsibleId: null }, { responsible: { organizationId } }] }
    ]
  }
}

router.get('/expenses', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where = await expenseScope(organizationId)
    if (req.query.status) where.status = enumValue(req.query.status, 'status', Object.values(ExpenseStatus))
    if (req.query.propertyId) where.propertyId = String(req.query.propertyId)
    if (req.query.dealId) where.dealId = String(req.query.dealId)
    if (req.query.from || req.query.to) {
      where.spentAt = {
        ...(req.query.from ? { gte: dateValue(req.query.from, 'from', true)! } : {}),
        ...(req.query.to ? { lte: dateValue(req.query.to, 'to', true)! } : {})
      }
    }
    const [total, expenses] = await Promise.all([
      prisma.expense.count({ where }),
      prisma.expense.findMany({
        where,
        skip,
        take: limit,
        orderBy: { spentAt: 'desc' },
        include: { property: { select: { id: true, title: true } }, deal: { select: { id: true, referenceNumber: true } }, responsible: { select: { id: true, email: true } } }
      })
    ])
    res.json({ success: true, data: expenses, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error) {
    next(error)
  }
})

router.post('/expenses', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const propertyId = optionalString(req.body?.propertyId, 'propertyId', 100)
    const dealId = optionalString(req.body?.dealId, 'dealId', 100)
    const responsibleId = optionalString(req.body?.responsibleId, 'responsibleId', 100) || userId
    if (!propertyId && !dealId) throw createError('A property or deal is required', 400)
    if (propertyId) await assertProperty(propertyId, organizationId)
    if (dealId) await assertDeal(dealId, organizationId)
    await assertUser(responsibleId, organizationId)

    const amount = parseMoney(req.body?.amount, 'amount', { required: true, min: 0.01 })!
    const currency = (optionalString(req.body?.currency, 'currency', 3) || 'USD').toUpperCase()
    const conversion = convertToBase(amount, currency, await baseCurrencyOf(organizationId), req.body?.exchangeRate)
    const status = enumValue(req.body?.status, 'status', Object.values(ExpenseStatus), ExpenseStatus.PENDING)
    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          propertyId,
          dealId,
          responsibleId,
          category: requiredString(req.body?.category, 'category', 100),
          description: optionalString(req.body?.description, 'description', 500),
          amount,
          currency,
          status,
          exchangeRate: conversion.exchangeRate,
          baseAmount: conversion.baseAmount,
          spentAt: dateValue(req.body?.spentAt, 'spentAt') || new Date(),
          paidAt: status === ExpenseStatus.PAID ? new Date() : undefined
        }
      })
      await logAudit(tx, { userId, action: 'EXPENSE_RECORDED', entityType: 'Expense', entityId: created.id, details: { amount, currency, status, propertyId, dealId } })
      return created
    })
    res.status(201).json({ success: true, data: expense, message: 'Expense recorded successfully' })
  } catch (error) {
    next(error)
  }
})

router.patch('/expenses/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.expense.findFirst({ where: { id, deletedAt: null, ...(await expenseScope(organizationId)) } })
    if (!existing) throw createError('Expense not found', 404)

    const body = req.body as Record<string, unknown>
    const data: Prisma.ExpenseUpdateInput = {}
    if (body.category !== undefined) data.category = requiredString(body.category, 'category', 100)
    if (body.description !== undefined) data.description = optionalString(body.description, 'description', 500)
    let amount = existing.amount.toString()
    let currency = existing.currency
    let rate: unknown = existing.exchangeRate?.toString()
    if (body.amount !== undefined) amount = parseMoney(body.amount, 'amount', { required: true, min: 0.01 })!
    if (body.currency !== undefined) currency = (optionalString(body.currency, 'currency', 3) || currency).toUpperCase()
    if (body.exchangeRate !== undefined) rate = body.exchangeRate
    const conversion = convertToBase(amount, currency, await baseCurrencyOf(organizationId), rate)
    data.amount = amount
    data.currency = currency
    data.exchangeRate = conversion.exchangeRate
    data.baseAmount = conversion.baseAmount
    if (body.status !== undefined) data.status = enumValue(body.status, 'status', Object.values(ExpenseStatus))
    if (body.spentAt !== undefined) data.spentAt = dateValue(body.spentAt, 'spentAt')!
    if (body.paidAt !== undefined) data.paidAt = dateValue(body.paidAt, 'paidAt')

    const expense = await prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({ where: { id }, data })
      await logAudit(tx, { userId, action: 'EXPENSE_UPDATED', entityType: 'Expense', entityId: id, details: { amount, currency, data: Object.keys(data) } })
      return updated
    })
    res.json({ success: true, data: expense, message: 'Expense updated successfully' })
  } catch (error) {
    next(error)
  }
})

router.delete('/expenses/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.expense.findFirst({ where: { id, deletedAt: null, ...(await expenseScope(organizationId)) } })
    if (!existing) throw createError('Expense not found', 404)
    await prisma.$transaction(async (tx) => {
      await tx.expense.update({ where: { id }, data: { deletedAt: new Date() } })
      await logAudit(tx, { userId, action: 'EXPENSE_ARCHIVED', entityType: 'Expense', entityId: id })
    })
    res.json({ success: true, message: 'Expense archived successfully' })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// Commissions
// ---------------------------------------------------------------------------

const COMMISSION_TRANSITIONS: Record<CommissionStatus, CommissionStatus[]> = {
  [CommissionStatus.PENDING]: [CommissionStatus.APPROVED, CommissionStatus.CANCELLED],
  [CommissionStatus.APPROVED]: [CommissionStatus.PAID, CommissionStatus.CANCELLED],
  [CommissionStatus.PAID]: [],
  [CommissionStatus.CANCELLED]: []
}

async function commissionScope(organizationId: string): Promise<Prisma.CommissionWhereInput> {
  return { deletedAt: null, deal: { organizationId } }
}

router.get('/commissions', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where = await commissionScope(organizationId)
    if (req.query.status) where.status = enumValue(req.query.status, 'status', Object.values(CommissionStatus))
    const [total, commissions] = await Promise.all([
      prisma.commission.count({ where }),
      prisma.commission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { deal: { select: { id: true, referenceNumber: true } }, user: { select: { id: true, email: true, firstName: true } } }
      })
    ])
    res.json({ success: true, data: commissions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error) {
    next(error)
  }
})

router.post('/commissions', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const dealId = requiredString(req.body?.dealId, 'dealId', 100)
    const deal = await assertDeal(dealId, organizationId)
    const responsibleId = optionalString(req.body?.userId, 'userId', 100)
    if (responsibleId) await assertUser(responsibleId, organizationId)
    if (responsibleId && responsibleId === userId) {
      throw createError('You cannot configure a commission for yourself', 400)
    }

    const rate = parseRate(req.body?.rate)
    let amount = parseMoney(req.body?.amount, 'amount', { min: 0 })
    if (amount && rate) {
      amount = commissionAmount(amount, rate)
    } else if (!amount && rate) {
      amount = commissionAmount(deal.amount, rate)
    }
    if (!amount) throw createError('amount or rate is required', 400)
    const currency = (optionalString(req.body?.currency, 'currency', 3) || deal.currency).toUpperCase()
    const conversion = convertToBase(amount, currency, await baseCurrencyOf(organizationId), req.body?.exchangeRate)

    const commission = await prisma.$transaction(async (tx) => {
      const created = await tx.commission.create({
        data: {
          dealId,
          userId: responsibleId,
          amount,
          currency,
          rate,
          status: CommissionStatus.PENDING,
          notes: optionalString(req.body?.notes, 'notes', 5000),
          exchangeRate: conversion.exchangeRate,
          baseAmount: conversion.baseAmount
        }
      })
      await logAudit(tx, { userId, action: 'COMMISSION_CONFIGURED', entityType: 'Commission', entityId: created.id, details: { dealId, amount, rate, currency } })
      return created
    })
    res.status(201).json({ success: true, data: commission, message: 'Commission configured successfully' })
  } catch (error) {
    next(error)
  }
})

router.patch('/commissions/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.commission.findFirst({ where: { id, deletedAt: null, ...(await commissionScope(organizationId)) } })
    if (!existing) throw createError('Commission not found', 404)

    const body = req.body as Record<string, unknown>
    const data: Prisma.CommissionUpdateInput = {}
    const nextStatus = body.status !== undefined
      ? enumValue(body.status, 'status', Object.values(CommissionStatus))
      : existing.status
    if (nextStatus !== existing.status && !COMMISSION_TRANSITIONS[existing.status].includes(nextStatus)) {
      throw createError(`Invalid commission status transition: ${existing.status} to ${nextStatus}`, 400)
    }
    if (nextStatus !== existing.status && (nextStatus === CommissionStatus.APPROVED || nextStatus === CommissionStatus.PAID)) {
      requireAnyRole(req, MANAGEMENT_ROLES)
      if (existing.userId === userId) {
        throw createError('You cannot approve or pay your own commission', 403)
      }
    }
    if (body.status !== undefined) data.status = nextStatus
    if (body.notes !== undefined) data.notes = optionalString(body.notes, 'notes', 5000)
    if (nextStatus === CommissionStatus.APPROVED && !existing.approvedAt) data.approvedAt = new Date()
    if (nextStatus === CommissionStatus.PAID && !existing.paidAt) {
      data.paidAt = new Date()
      data.paymentReference = optionalString(body.paymentReference, 'paymentReference', 150)
    }

    const commission = await prisma.$transaction(async (tx) => {
      const updated = await tx.commission.update({ where: { id }, data })
      await logAudit(tx, { userId, action: 'COMMISSION_UPDATED', entityType: 'Commission', entityId: id, details: { before: existing.status, after: nextStatus } })
      const deal = await tx.deal.findFirst({ where: { id: existing.dealId }, select: { userId: true, referenceNumber: true } })
      const recipients = await organizationRecipientIds(tx, organizationId, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: [updated.userId || '', existing.userId || '', deal?.userId || ''],
        excludeUserId: userId
      })
      if (recipients.length && existing.status !== updated.status) {
        await notifyUsers(tx, recipients, {
          organizationId,
          type: 'COMMISSION_STATUS_CHANGED',
          title: 'Commission status updated',
          message: `Commission for ${deal?.referenceNumber || 'a deal'} is now ${updated.status}.`,
          entityType: 'Commission',
          entityId: id,
          actionUrl: `/deals/${existing.dealId}`,
          metadata: { dealId: existing.dealId, beforeStatus: existing.status, afterStatus: updated.status }
        })
      }
      return updated
    })
    res.json({ success: true, data: commission, message: 'Commission updated successfully' })
  } catch (error) {
    next(error)
  }
})

router.delete('/commissions/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.commission.findFirst({ where: { id, deletedAt: null, ...(await commissionScope(organizationId)) } })
    if (!existing) throw createError('Commission not found', 404)
    await prisma.$transaction(async (tx) => {
      await tx.commission.update({ where: { id }, data: { deletedAt: new Date() } })
      await logAudit(tx, { userId, action: 'COMMISSION_ARCHIVED', entityType: 'Commission', entityId: id })
    })
    res.json({ success: true, message: 'Commission archived successfully' })
  } catch (error) {
    next(error)
  }
})

export default router
