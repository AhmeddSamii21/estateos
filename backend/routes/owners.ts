import { Router } from 'express'
import { OwnerPayoutStatus, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { FINANCE_ROLES, MANAGEMENT_ROLES, organizationIdOf, ownerReadScope, userIdOf } from '../utils/scope'
import { booleanValue, dateValue, optionalString, pagination, requiredString } from '../utils/validation'
import { logAudit } from '../utils/audit'
import { parseMoney } from '../utils/money'
import {
  buildOwnerStatement,
  canViewOwnerFinancials,
  ownerStatementDealWhere,
  ownerStatementExpenseWhere,
  ownerStatementOwnerWhere,
  ownerStatementPaymentWhere,
  ownerStatementPropertyWhere,
  type StatementDeal,
  type StatementExpense,
  type StatementPayment,
  type StatementProperty
} from '../utils/ownerStatement'

const router = Router()
router.use(authMiddleware)

function ownerLabel(owner: { firstName: string | null; lastName: string | null; companyName: string | null }): string | null {
  const person = [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim()
  return owner.companyName || person || null
}

function ownerWhere(organizationId: string, query: Record<string, unknown>): Prisma.OwnerWhereInput {
  const where: Prisma.OwnerWhereInput = {
    ...ownerReadScope(organizationId),
    deletedAt: null
  }
  const includeInactive = String(query.includeInactive || '') === 'true'
  if (!includeInactive) where.isActive = true
  const search = optionalString(query.search, 'search', 200)
  if (search) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { companyName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } }
        ]
      }
    ]
  }
  return where
}

// Writes are restricted to owners that actually belong to this organization.
// Legacy null-org owners stay readable when linked locally, but must not be
// claimed or mutated from another tenant.
function findWritableOwner(id: string, organizationId: string) {
  return prisma.owner.findFirst({
    where: { id, organizationId, deletedAt: null }
  })
}

function payoutSummary(rows: Array<{ amount: Prisma.Decimal; status: OwnerPayoutStatus }>) {
  const sum = (status: OwnerPayoutStatus) =>
    rows.filter((row) => row.status === status)
      .reduce((total, row) => total.plus(row.amount), new Prisma.Decimal(0))
      .toFixed(2)
  return {
    pending: sum(OwnerPayoutStatus.PENDING),
    settled: sum(OwnerPayoutStatus.SETTLED),
    cancelled: sum(OwnerPayoutStatus.CANCELLED),
    count: rows.length
  }
}

/**
 * Read-only owner statement. The owner itself is resolved with ownerReadScope
 * (legacy null-org owners are visible only through a local property link), and
 * every related row is scoped to the viewer's organization. Financial amounts
 * are queried only for finance roles; everyone else receives counts and an
 * explicit financialsRestricted flag instead of redacted zero amounts.
 */
router.get('/:id/statement', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const includeFinancials = canViewOwnerFinancials(req.user?.role)

    const owner = await prisma.owner.findFirst({
      where: ownerStatementOwnerWhere(organizationId, id),
      select: { id: true, firstName: true, lastName: true, companyName: true }
    })
    if (!owner) throw createError('Owner not found', 404)

    const properties = await prisma.property.findMany({
      where: ownerStatementPropertyWhere(organizationId, id),
      select: {
        id: true, title: true, referenceNumber: true, status: true, city: true,
        price: true, currency: true, isActive: true
      },
      orderBy: { updatedAt: 'desc' },
      take: 1000
    })
    const propertyIds = properties.map((property) => property.id)

    const deals = propertyIds.length
      ? await prisma.deal.findMany({
          where: ownerStatementDealWhere(organizationId, propertyIds),
          select: includeFinancials
            ? { id: true, status: true, type: true, amount: true, currency: true }
            : { id: true, status: true, type: true },
          orderBy: { createdAt: 'desc' },
          take: 5000
        })
      : []
    const dealIds = deals.map((deal) => deal.id)

    const payments: StatementPayment[] = includeFinancials && dealIds.length
      ? (await prisma.payment.findMany({
          where: ownerStatementPaymentWhere(dealIds),
          select: { id: true, status: true, amount: true, currency: true },
          take: 5000
        })).map((payment) => ({ ...payment }))
      : []
    const expenses: StatementExpense[] = includeFinancials && propertyIds.length
      ? (await prisma.expense.findMany({
          where: ownerStatementExpenseWhere(propertyIds),
          select: { id: true, status: true, amount: true, currency: true },
          take: 5000
        })).map((expense) => ({ ...expense }))
      : []

    const propertyRows: StatementProperty[] = properties.map((property) => ({ ...property }))
    const dealRows: StatementDeal[] = deals.map((deal) => ({
      id: deal.id,
      status: deal.status,
      type: deal.type,
      amount: 'amount' in deal ? deal.amount : 0,
      currency: 'currency' in deal ? deal.currency : null
    }))

    const statement = buildOwnerStatement(
      { id: owner.id, displayName: ownerLabel(owner) },
      { properties: propertyRows, deals: dealRows, payments, expenses },
      { includeFinancials }
    )
    res.json({ success: true, data: statement })
  } catch (error) {
    next(error)
  }
})

/**
 * Package 18: payout records are additive. Every query is restricted to the
 * viewer's organization and to an owner that is readable in this tenant.
 */
router.get('/:id/payouts', requireRole(FINANCE_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const owner = await prisma.owner.findFirst({
      where: { id, ...ownerReadScope(organizationId), deletedAt: null },
      select: { id: true }
    })
    if (!owner) throw createError('Owner not found', 404)
    const where: Prisma.OwnerPayoutWhereInput = {
      deletedAt: null,
      organizationId,
      ownerId: id,
      ...(req.query.status
        ? { status: (() => {
            const value = String(req.query.status).toUpperCase()
            if (!Object.values(OwnerPayoutStatus).includes(value as OwnerPayoutStatus)) {
              throw createError('Invalid payout status', 400)
            }
            return value as OwnerPayoutStatus
          })() }
        : {})
    }
    const [payouts, rows] = await Promise.all([
      prisma.ownerPayout.findMany({ where, orderBy: { createdAt: 'desc' }, take: 1000 }),
      prisma.ownerPayout.findMany({
        where: { deletedAt: null, organizationId, ownerId: id },
        select: { amount: true, status: true },
        take: 10000
      })
    ])
    res.json({ success: true, data: payouts, summary: payoutSummary(rows) })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/payouts', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    if (!await findWritableOwner(id, organizationId)) throw createError('Owner not found', 404)
    const amount = parseMoney(req.body?.amount, 'amount', { min: 0 })
    if (!amount || new Prisma.Decimal(amount).lte(0)) throw createError('amount must be greater than zero', 400)
    const currency = (requiredString(req.body?.currency, 'currency', 3) || 'USD').toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) throw createError('currency must be a 3-letter code', 400)
    const periodStart = dateValue(req.body?.periodStart, 'periodStart')
    const periodEnd = dateValue(req.body?.periodEnd, 'periodEnd')
    if (periodStart && periodEnd && periodStart > periodEnd) {
      throw createError('periodStart must be before periodEnd', 400)
    }
    const payout = await prisma.$transaction(async (tx) => {
      const created = await tx.ownerPayout.create({
        data: {
          organizationId,
          ownerId: id,
          amount,
          currency,
          reference: optionalString(req.body?.reference, 'reference', 120),
          notes: optionalString(req.body?.notes, 'notes', 5000),
          periodStart,
          periodEnd,
          createdById: userIdOf(req)
        }
      })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'OWNER_PAYOUT_CREATED',
        entityType: 'OwnerPayout',
        entityId: created.id,
        details: { ownerId: id, amount, currency }
      })
      return created
    })
    res.status(201).json({ success: true, data: payout, message: 'Payout recorded successfully' })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/payouts/:payoutId', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const payoutId = String(req.params.payoutId)
    if (!await findWritableOwner(id, organizationId)) throw createError('Owner not found', 404)
    const existing = await prisma.ownerPayout.findFirst({
      where: { id: payoutId, ownerId: id, organizationId, deletedAt: null }
    })
    if (!existing) throw createError('Payout not found', 404)
    const requested = String(req.body?.status ?? OwnerPayoutStatus.SETTLED).toUpperCase()
    if (!Object.values(OwnerPayoutStatus).includes(requested as OwnerPayoutStatus)) {
      throw createError('Invalid payout status', 400)
    }
    const status = requested as OwnerPayoutStatus
    const payout = await prisma.$transaction(async (tx) => {
      const updated = await tx.ownerPayout.update({
        where: { id: payoutId },
        data: {
          status,
          ...(status === OwnerPayoutStatus.SETTLED
            ? { settledAt: existing.settledAt ?? new Date(), settledById: userIdOf(req) }
            : { settledAt: null, settledById: null })
        }
      })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: status === OwnerPayoutStatus.SETTLED ? 'OWNER_PAYOUT_SETTLED' : 'OWNER_PAYOUT_UPDATED',
        entityType: 'OwnerPayout',
        entityId: payoutId,
        details: { ownerId: id, before: existing.status, after: status, amount: updated.amount.toString() }
      })
      return updated
    })
    res.json({ success: true, data: payout, message: 'Payout updated successfully' })
  } catch (error) {
    next(error)
  }
})

router.get('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where = ownerWhere(organizationId, req.query as Record<string, unknown>)
    const [total, owners] = await Promise.all([
      prisma.owner.count({ where }),
      prisma.owner.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
        include: {
          _count: { select: { properties: { where: { organizationId, deletedAt: null, isActive: true } } } }
        }
      })
    ])
    res.json({
      success: true,
      data: owners.map((owner) => ({ ...owner, displayName: ownerLabel(owner) })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    next(error)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const owner = await prisma.owner.findFirst({
      where: { id, ...ownerReadScope(organizationId), deletedAt: null },
      include: {
        properties: {
          where: { organizationId, deletedAt: null, isActive: true },
          select: { id: true, title: true, referenceNumber: true, status: true, city: true, price: true, currency: true },
          orderBy: { updatedAt: 'desc' }
        }
      }
    })
    if (!owner) throw createError('Owner not found', 404)
    res.json({ success: true, data: { ...owner, displayName: ownerLabel(owner) } })
  } catch (error) {
    next(error)
  }
})

router.post('/', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const data = {
      organizationId,
      firstName: optionalString(req.body?.firstName, 'firstName', 100),
      lastName: optionalString(req.body?.lastName, 'lastName', 100),
      companyName: optionalString(req.body?.companyName, 'companyName', 200),
      email: optionalString(req.body?.email, 'email', 254),
      phone: optionalString(req.body?.phone, 'phone', 50),
      address: optionalString(req.body?.address, 'address', 500),
      city: optionalString(req.body?.city, 'city', 120),
      country: optionalString(req.body?.country, 'country', 120),
      notes: optionalString(req.body?.notes, 'notes', 5000),
      isActive: booleanValue(req.body?.isActive, 'isActive', true)
    }
    if (!ownerLabel({ firstName: data.firstName ?? null, lastName: data.lastName ?? null, companyName: data.companyName ?? null })) {
      throw createError('Provide at least a first name, last name, or company name', 400)
    }
    const owner = await prisma.$transaction(async (tx) => {
      const created = await tx.owner.create({ data })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'OWNER_CREATED',
        entityType: 'Owner',
        entityId: created.id,
        details: { isActive: created.isActive }
      })
      return created
    })
    res.status(201).json({ success: true, data: { ...owner, displayName: ownerLabel(owner) }, message: 'Owner created successfully' })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const existing = await findWritableOwner(id, organizationId)
    if (!existing) throw createError('Owner not found', 404)

    const body = req.body as Record<string, unknown>
    const data: Prisma.OwnerUpdateInput = {}
    for (const [key, max] of [
      ['firstName', 100], ['lastName', 100], ['companyName', 200], ['email', 254],
      ['phone', 50], ['address', 500], ['city', 120], ['country', 120], ['notes', 5000]
    ] as Array<[keyof Prisma.OwnerUpdateInput & string, number]>) {
      if (body[key] !== undefined) data[key] = optionalString(body[key], key, max) as never
    }
    if (body.isActive !== undefined) data.isActive = booleanValue(body.isActive, 'isActive')

    const candidate = {
      firstName: (data.firstName as string | undefined) ?? existing.firstName,
      lastName: (data.lastName as string | undefined) ?? existing.lastName,
      companyName: (data.companyName as string | undefined) ?? existing.companyName
    }
    if (!ownerLabel(candidate)) throw createError('Provide at least a first name, last name, or company name', 400)
    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.owner.update({ where: { id }, data })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'OWNER_UPDATED',
        entityType: 'Owner',
        entityId: id,
        details: { fields: Object.keys(body).filter((key) => key !== 'isActive'), isActive: record.isActive }
      })
      return record
    })
    res.json({ success: true, data: { ...updated, displayName: ownerLabel(updated) }, message: 'Owner updated successfully' })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const existing = await findWritableOwner(id, organizationId)
    if (!existing) throw createError('Owner not found', 404)
    // Preserve historical ownership links on properties/documents; only hide owner from active lists.
    await prisma.$transaction(async (tx) => {
      await tx.owner.update({ where: { id }, data: { isActive: false } })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'OWNER_ARCHIVED',
        entityType: 'Owner',
        entityId: id,
        details: { isActive: false }
      })
    })
    res.json({ success: true, message: 'Owner archived successfully' })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/restore', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const existing = await findWritableOwner(id, organizationId)
    if (!existing) throw createError('Owner not found', 404)
    const owner = await prisma.$transaction(async (tx) => {
      const restored = await tx.owner.update({ where: { id }, data: { isActive: true, deletedAt: null } })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'OWNER_RESTORED',
        entityType: 'Owner',
        entityId: id,
        details: { isActive: true }
      })
      return restored
    })
    res.json({ success: true, data: { ...owner, displayName: ownerLabel(owner) }, message: 'Owner restored successfully' })
  } catch (error) {
    next(error)
  }
})

export default router
