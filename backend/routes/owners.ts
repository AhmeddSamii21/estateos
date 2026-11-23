import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { MANAGEMENT_ROLES, organizationIdOf, ownerReadScope, userIdOf } from '../utils/scope'
import { booleanValue, optionalString, pagination } from '../utils/validation'
import { logAudit } from '../utils/audit'

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
