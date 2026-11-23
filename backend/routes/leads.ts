import { Router } from 'express'
import { LeadStatus, Prisma, PropertyStatus, PropertyType } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { leadScope, organizationIdOf, roleOf, userIdOf } from '../utils/scope'
import { booleanValue, enumValue, numberValue, optionalString, pagination, requiredString } from '../utils/validation'
import { parseMoney } from '../utils/money'
import { notifyUsers, organizationRecipientIds } from '../services/notifications'
import { logAudit } from '../utils/audit'
import { scoreLeadPropertyMatch } from '../utils/leadMatching'
import { followUpWhere, nullableDateValue, type FollowUpBucket } from '../utils/followUps'

const router = Router()
router.use(authMiddleware)

function scope(organizationId: string): Prisma.LeadWhereInput {
  return { deletedAt: null, ...leadScope(organizationId) }
}

async function assertAssignable(assignedToId: string | undefined, propertyId: string | undefined, organizationId: string) {
  if (assignedToId) {
    const user = await prisma.user.findFirst({ where: { id: assignedToId, organizationId, deletedAt: null }, select: { id: true } })
    if (!user) throw createError('Assigned user not found', 404)
  }
  if (propertyId) {
    const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId, deletedAt: null }, select: { id: true } })
    if (!property) throw createError('Property not found', 404)
  }
}



function parseLeadCriteria(body: Record<string, unknown>) {
  const toMoneyInput = (value: unknown) => {
    if (value === undefined) return undefined
    if (value === null || value === '') return null
    if (typeof value === 'object' && value && 'toString' in value) return String((value as { toString(): string }).toString())
    return value
  }
  const toNumberInput = (value: unknown) => {
    if (value === undefined) return undefined
    if (value === null || value === '') return null
    if (typeof value === 'object' && value && 'toString' in value) return Number((value as { toString(): string }).toString())
    return value
  }

  const budgetMinRaw = toMoneyInput(body.budgetMin)
  const budgetMaxRaw = toMoneyInput(body.budgetMax)
  const budgetMin = budgetMinRaw === undefined ? undefined : budgetMinRaw === null ? null : parseMoney(budgetMinRaw, 'budgetMin', { min: 0 })
  const budgetMax = budgetMaxRaw === undefined ? undefined : budgetMaxRaw === null ? null : parseMoney(budgetMaxRaw, 'budgetMax', { min: 0 })
  if (typeof budgetMin === 'string' && typeof budgetMax === 'string' && Number(budgetMin) > Number(budgetMax)) {
    throw createError('budgetMin cannot be greater than budgetMax', 400)
  }

  const areaMinRaw = toNumberInput(body.preferredAreaMin)
  const areaMaxRaw = toNumberInput(body.preferredAreaMax)
  const preferredAreaMin = areaMinRaw === undefined ? undefined : areaMinRaw === null ? null : numberValue(areaMinRaw, 'preferredAreaMin', { min: 0 })
  const preferredAreaMax = areaMaxRaw === undefined ? undefined : areaMaxRaw === null ? null : numberValue(areaMaxRaw, 'preferredAreaMax', { min: 0 })
  if (typeof preferredAreaMin === 'number' && typeof preferredAreaMax === 'number' && preferredAreaMin > preferredAreaMax) {
    throw createError('preferredAreaMin cannot be greater than preferredAreaMax', 400)
  }

  const bedroomsRaw = toNumberInput(body.preferredBedrooms)
  const preferredBedrooms = bedroomsRaw === undefined ? undefined : bedroomsRaw === null ? null : numberValue(bedroomsRaw, 'preferredBedrooms', { min: 0 })
  if (typeof preferredBedrooms === 'number' && !Number.isInteger(preferredBedrooms)) {
    throw createError('preferredBedrooms must be an integer', 400)
  }

  const preferredType = body.preferredType === '' || body.preferredType === null
    ? null
    : body.preferredType === undefined
      ? undefined
      : enumValue(body.preferredType, 'preferredType', Object.values(PropertyType))

  const preferredCity = body.preferredCity === undefined
    ? undefined
    : body.preferredCity === null || body.preferredCity === ''
      ? null
      : optionalString(body.preferredCity, 'preferredCity', 120)

  return { budgetMin, budgetMax, preferredType, preferredCity, preferredBedrooms, preferredAreaMin, preferredAreaMax }
}

const LEAD_MATCH_LIMIT = 12
const leadMatchScore = scoreLeadPropertyMatch

router.get('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where = scope(organizationId)
    if (req.query.status) where.status = enumValue(req.query.status, 'status', Object.values(LeadStatus))
    if (req.query.followUp) {
      const bucket = enumValue(req.query.followUp, 'followUp', ['overdue', 'today', 'upcoming'] as const) as FollowUpBucket
      const bucketWhere = followUpWhere(bucket)
      where.nextFollowUpAt = bucketWhere.nextFollowUpAt
    }
    if (req.query.search) {
      const search = String(req.query.search)
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } }
          ]
        }
      ]
    }

    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } })
    ])
    res.json({ success: true, data: leads, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/matches', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const lead = await prisma.lead.findFirst({ where: { id, ...scope(organizationId) } })
    if (!lead) throw createError('Lead not found', 404)

    const role = roleOf(req)
    const propertyWhere: Prisma.PropertyWhereInput = {
      organizationId,
      deletedAt: null,
      isActive: true,
      status: PropertyStatus.AVAILABLE,
      ...(role === 'AGENT' ? { assignedAgentId: userIdOf(req) } : {})
    }

    const criteria: Prisma.PropertyWhereInput[] = []
    if (lead.preferredType) criteria.push({ type: lead.preferredType })
    if (lead.preferredCity?.trim()) {
      const city = lead.preferredCity.trim()
      criteria.push({
        OR: [
          { city: { contains: city, mode: 'insensitive' } },
          { state: { contains: city, mode: 'insensitive' } },
          { country: { contains: city, mode: 'insensitive' } },
          { address: { contains: city, mode: 'insensitive' } }
        ]
      })
    }
    if (lead.budgetMin !== null || lead.budgetMax !== null) {
      criteria.push({
        price: {
          ...(lead.budgetMin !== null ? { gte: lead.budgetMin } : {}),
          ...(lead.budgetMax !== null ? { lte: lead.budgetMax } : {})
        }
      })
    }
    if (lead.preferredBedrooms !== null) {
      criteria.push({
        bedrooms: {
          gte: Math.max(0, lead.preferredBedrooms - 1),
          lte: lead.preferredBedrooms + 1
        }
      })
    }
    if (lead.preferredAreaMin !== null || lead.preferredAreaMax !== null) {
      criteria.push({
        OR: [
          { area: null },
          {
            area: {
              ...(lead.preferredAreaMin !== null ? { gte: lead.preferredAreaMin } : {}),
              ...(lead.preferredAreaMax !== null ? { lte: lead.preferredAreaMax } : {})
            }
          }
        ]
      })
    }
    if (criteria.length > 0) propertyWhere.AND = criteria

    const properties = await prisma.property.findMany({
      where: propertyWhere,
      take: 60,
      orderBy: [{ featured: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        referenceNumber: true,
        title: true,
        type: true,
        status: true,
        city: true,
        state: true,
        country: true,
        address: true,
        bedrooms: true,
        bathrooms: true,
        area: true,
        areaUnit: true,
        price: true,
        currency: true,
        assignedAgentId: true
      }
    })

    const matches = properties
      .map((property) => {
        const { score, reasons } = leadMatchScore(lead, property)
        return { property, score, reasons }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.property.price) - Number(b.property.price))
      .slice(0, LEAD_MATCH_LIMIT)

    res.json({
      success: true,
      data: {
        leadId: lead.id,
        criteria: {
          budgetMin: lead.budgetMin,
          budgetMax: lead.budgetMax,
          preferredType: lead.preferredType,
          preferredCity: lead.preferredCity,
          preferredBedrooms: lead.preferredBedrooms,
          preferredAreaMin: lead.preferredAreaMin,
          preferredAreaMax: lead.preferredAreaMax
        },
        matches
      }
    })
  } catch (error) {
    next(error)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const lead = await prisma.lead.findFirst({
      where: { id: String(req.params.id), ...scope(organizationId) },
      include: {
        followUpNotes: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { author: { select: { id: true, firstName: true, email: true } } }
        }
      }
    })
    if (!lead) throw createError('Lead not found', 404)
    res.json({ success: true, data: lead })
  } catch (error) {
    next(error)
  }
})

// Quick follow-up/call note: one write records the interaction, stamps the
// last contact, and optionally schedules (or clears) the next follow-up.
router.post('/:id/follow-ups', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const actorId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.lead.findFirst({ where: { id, ...scope(organizationId) } })
    if (!existing) throw createError('Lead not found', 404)

    const body = req.body as Record<string, unknown>
    const text = requiredString(body.body ?? body.note, 'body', 2000)
    const nextFollowUpAt = nullableDateValue(body.nextFollowUpAt, 'nextFollowUpAt')
    const contactedAt = new Date()

    const result = await prisma.$transaction(async (tx) => {
      const note = await tx.leadNote.create({
        data: {
          leadId: id,
          authorId: actorId,
          body: text,
          ...(nextFollowUpAt !== undefined ? { nextFollowUpAt } : {})
        },
        include: { author: { select: { id: true, firstName: true, email: true } } }
      })
      const lead = await tx.lead.update({
        where: { id },
        data: {
          lastContactedAt: contactedAt,
          ...(nextFollowUpAt !== undefined ? { nextFollowUpAt } : {})
        }
      })
      await logAudit(tx, {
        userId: actorId,
        action: 'LEAD_FOLLOW_UP_LOGGED',
        entityType: 'Lead',
        entityId: id,
        details: { noteId: note.id, nextFollowUpAt: nextFollowUpAt ?? null }
      })
      return { note, lead }
    })

    const recipients = await organizationRecipientIds(prisma, organizationId, {
      roles: ['ADMIN', 'MANAGER'],
      includeUserIds: existing.assignedToId ? [existing.assignedToId] : [],
      excludeUserId: actorId
    })
    if (recipients.length) {
      await notifyUsers(prisma, recipients, {
        organizationId,
        type: 'LEAD_FOLLOW_UP_LOGGED',
        title: 'Lead follow-up logged',
        message: `${existing.firstName}${existing.lastName ? ` ${existing.lastName}` : ''}: ${text.slice(0, 160)}`,
        entityType: 'Lead',
        entityId: id,
        actionUrl: '/leads',
        metadata: { noteId: result.note.id, nextFollowUpAt: result.lead.nextFollowUpAt?.toISOString() || null }
      })
    }

    res.status(201).json({
      success: true,
      data: result,
      message: 'Follow-up note logged successfully'
    })
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const body = req.body as Record<string, unknown>
    const assignedToId = optionalString(body.assignedToId, 'assignedToId', 100) || userIdOf(req)
    const propertyId = optionalString(body.propertyId, 'propertyId', 100)
    await assertAssignable(assignedToId, propertyId, organizationId)
    const criteria = parseLeadCriteria(body)

    const lead = await prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          firstName: requiredString(body.firstName, 'firstName', 100),
          lastName: optionalString(body.lastName, 'lastName', 100),
          email: optionalString(body.email, 'email', 254),
          phone: optionalString(body.phone, 'phone', 50),
          status: enumValue(body.status, 'status', Object.values(LeadStatus), LeadStatus.NEW),
          source: optionalString(body.source, 'source', 100),
          notes: optionalString(body.notes, 'notes', 5000),
          budgetMin: criteria.budgetMin,
          budgetMax: criteria.budgetMax,
          preferredType: criteria.preferredType ?? undefined,
          preferredCity: criteria.preferredCity,
          preferredBedrooms: criteria.preferredBedrooms,
          preferredAreaMin: criteria.preferredAreaMin,
          preferredAreaMax: criteria.preferredAreaMax,
          assignedToId,
          propertyId,
          nextFollowUpAt: nullableDateValue(body.nextFollowUpAt, 'nextFollowUpAt')
        }
      })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'LEAD_CREATED',
        entityType: 'Lead',
        entityId: created.id,
        details: { status: created.status, assignedToId: created.assignedToId, propertyId: created.propertyId }
      })
      return created
    })
    const recipients = await organizationRecipientIds(prisma, organizationId, {
      roles: ['ADMIN', 'MANAGER'],
      includeUserIds: assignedToId ? [assignedToId] : [],
      excludeUserId: userIdOf(req)
    })
    await notifyUsers(prisma, recipients, {
      organizationId,
      type: 'LEAD_CREATED',
      title: 'New lead created',
      message: `${lead.firstName}${lead.lastName ? ` ${lead.lastName}` : ''} was added.`,
      entityType: 'Lead',
      entityId: lead.id,
      actionUrl: `/leads`,
      metadata: { status: lead.status, assignedToId: lead.assignedToId, propertyId: lead.propertyId }
    })
    res.status(201).json({ success: true, data: lead, message: 'Lead created successfully' })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.lead.findFirst({ where: { id, ...scope(organizationId) } })
    if (!existing) throw createError('Lead not found', 404)

    const data: Prisma.LeadUpdateInput = {}
    const body = req.body as Record<string, unknown>
    if (body.firstName !== undefined) data.firstName = requiredString(body.firstName, 'firstName', 100)
    for (const field of ['lastName', 'email', 'phone', 'source', 'notes']) {
      if (body[field] !== undefined) data[field as 'lastName'] = optionalString(body[field], field, field === 'notes' ? 5000 : 254)
    }
    if (body.status !== undefined) data.status = enumValue(body.status, 'status', Object.values(LeadStatus))
    if (body.isActive !== undefined) data.isActive = booleanValue(body.isActive, 'isActive')
    if (body.nextFollowUpAt !== undefined) data.nextFollowUpAt = nullableDateValue(body.nextFollowUpAt, 'nextFollowUpAt')
    if (body.lastContactedAt !== undefined) data.lastContactedAt = nullableDateValue(body.lastContactedAt, 'lastContactedAt')
    const criteriaTouched = ['budgetMin', 'budgetMax', 'preferredType', 'preferredCity', 'preferredBedrooms', 'preferredAreaMin', 'preferredAreaMax']
    .some((field) => body[field] !== undefined)
  if (criteriaTouched) {
    const nextCriteria = {
      budgetMin: body.budgetMin === undefined ? existing.budgetMin : body.budgetMin,
      budgetMax: body.budgetMax === undefined ? existing.budgetMax : body.budgetMax,
      preferredType: body.preferredType === undefined ? existing.preferredType : body.preferredType,
      preferredCity: body.preferredCity === undefined ? existing.preferredCity : body.preferredCity,
      preferredBedrooms: body.preferredBedrooms === undefined ? existing.preferredBedrooms : body.preferredBedrooms,
      preferredAreaMin: body.preferredAreaMin === undefined ? existing.preferredAreaMin : body.preferredAreaMin,
      preferredAreaMax: body.preferredAreaMax === undefined ? existing.preferredAreaMax : body.preferredAreaMax
    } as Record<string, unknown>
    const criteria = parseLeadCriteria(nextCriteria)
    data.budgetMin = criteria.budgetMin ?? null
    data.budgetMax = criteria.budgetMax ?? null
    data.preferredType = criteria.preferredType ?? null
    data.preferredCity = criteria.preferredCity ?? null
    data.preferredBedrooms = criteria.preferredBedrooms ?? null
    data.preferredAreaMin = criteria.preferredAreaMin ?? null
    data.preferredAreaMax = criteria.preferredAreaMax ?? null
  }

  if (body.assignedToId !== undefined || body.propertyId !== undefined) {
      const assignedToId = (body.assignedToId === undefined ? existing.assignedToId : optionalString(body.assignedToId, 'assignedToId', 100)) ?? undefined
      const propertyId = (body.propertyId === undefined ? existing.propertyId : optionalString(body.propertyId, 'propertyId', 100)) ?? undefined
      await assertAssignable(assignedToId, propertyId, organizationId)
      data.assignedTo = assignedToId ? { connect: { id: assignedToId } } : { disconnect: true }
      data.property = propertyId ? { connect: { id: propertyId } } : { disconnect: true }
    }

    const lead = await prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({ where: { id }, data })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'LEAD_UPDATED',
        entityType: 'Lead',
        entityId: id,
        details: {
          before: { status: existing.status, assignedToId: existing.assignedToId, propertyId: existing.propertyId },
          after: { status: updated.status, assignedToId: updated.assignedToId, propertyId: updated.propertyId }
        }
      })
      return updated
    })

    const recipients = new Set<string>()
    const actorId = userIdOf(req)
    if (lead.assignedToId) recipients.add(lead.assignedToId)
    if (existing.assignedToId && existing.assignedToId !== lead.assignedToId) recipients.add(lead.assignedToId || '')
    if (existing.status !== lead.status || (existing.assignedToId !== lead.assignedToId)) {
      const managers = await organizationRecipientIds(prisma, organizationId, { roles: ['ADMIN', 'MANAGER'] })
      managers.forEach((uid) => recipients.add(uid))
    }
    recipients.delete(actorId)
    recipients.delete('')
    const changedStatus = existing.status !== lead.status
    const reassigned = existing.assignedToId !== lead.assignedToId
    if (recipients.size && (changedStatus || reassigned || body.notes !== undefined)) {
      await notifyUsers(prisma, Array.from(recipients), {
        organizationId,
        type: reassigned ? 'LEAD_ASSIGNED' : changedStatus ? 'LEAD_STATUS_CHANGED' : 'LEAD_UPDATED',
        title: reassigned ? 'Lead assignment updated' : changedStatus ? 'Lead status updated' : 'Lead updated',
        message: `${lead.firstName}${lead.lastName ? ` ${lead.lastName}` : ''}${changedStatus ? ` is now ${lead.status}` : reassigned ? ' was reassigned' : ' was updated'}.`,
        entityType: 'Lead',
        entityId: lead.id,
        actionUrl: `/leads`,
        metadata: { beforeStatus: existing.status, afterStatus: lead.status, beforeAssignee: existing.assignedToId, afterAssignee: lead.assignedToId }
      })
    }
    res.json({ success: true, data: lead, message: 'Lead updated successfully' })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.lead.findFirst({ where: { id, ...scope(organizationId) } })
    if (!existing) throw createError('Lead not found', 404)
    const lead = await prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'LEAD_ARCHIVED',
        entityType: 'Lead',
        entityId: id,
        details: { isActive: false }
      })
      return updated
    })
    res.json({ success: true, data: lead, message: 'Lead archived successfully' })
  } catch (error) {
    next(error)
  }
})

export default router
