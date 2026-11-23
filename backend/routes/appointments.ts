import { Router } from 'express'
import { AppointmentStatus, AppointmentType, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { leadScope, organizationIdOf, userIdOf } from '../utils/scope'
import { dateValue, enumValue, optionalString, pagination, requiredString } from '../utils/validation'
import { notifyUsers, organizationRecipientIds } from '../services/notifications'
import { logAudit } from '../utils/audit'
import {
  appointmentConflictWarnings,
  appointmentScope,
  assertValidAppointmentWindow,
  findAppointmentConflicts
} from '../utils/appointments'

const router = Router()
router.use(authMiddleware)

function scope(organizationId: string): Prisma.AppointmentWhereInput {
  return appointmentScope(organizationId)
}

async function assertRelated(userId: string | undefined, propertyId: string | undefined, leadId: string | undefined, organizationId: string) {
  if (userId) {
    const user = await prisma.user.findFirst({ where: { id: userId, organizationId, deletedAt: null }, select: { id: true } })
    if (!user) throw createError('User not found', 404)
  }
  if (propertyId) {
    const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId, deletedAt: null }, select: { id: true } })
    if (!property) throw createError('Property not found', 404)
  }
  if (leadId) {
    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        deletedAt: null,
        ...leadScope(organizationId)
      },
      select: { id: true }
    })
    if (!lead) throw createError('Lead not found', 404)
  }
}

router.get('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where = scope(organizationId)
    if (req.query.status) where.status = enumValue(req.query.status, 'status', Object.values(AppointmentStatus))
    if (req.query.from) {
      const from = dateValue(req.query.from, 'from', true)!
      where.startsAt = { gte: from }
    }

    const [total, appointments] = await Promise.all([
      prisma.appointment.count({ where }),
      prisma.appointment.findMany({ where, skip, take: limit, orderBy: { startsAt: 'asc' } })
    ])
    res.json({ success: true, data: appointments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error) {
    next(error)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const appointment = await prisma.appointment.findFirst({ where: { id: String(req.params.id), ...scope(organizationId) } })
    if (!appointment) throw createError('Appointment not found', 404)
    res.json({ success: true, data: appointment })
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = optionalString(req.body?.userId, 'userId', 100) || userIdOf(req)
    const propertyId = optionalString(req.body?.propertyId, 'propertyId', 100)
    const leadId = optionalString(req.body?.leadId, 'leadId', 100)
    await assertRelated(userId, propertyId, leadId, organizationId)

    const startsAt = dateValue(req.body?.startsAt, 'startsAt', true)!
    const endsAt = dateValue(req.body?.endsAt, 'endsAt')
    assertValidAppointmentWindow(startsAt, endsAt)

    const conflicts = await findAppointmentConflicts(prisma, {
      organizationId, startsAt, endsAt, userId, propertyId
    })

    const appointment = await prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          title: optionalString(req.body?.title, 'title', 200),
          type: enumValue(req.body?.type, 'type', Object.values(AppointmentType), AppointmentType.VIEWING),
          status: enumValue(req.body?.status, 'status', Object.values(AppointmentStatus), AppointmentStatus.SCHEDULED),
          startsAt,
          endsAt,
          notes: optionalString(req.body?.notes, 'notes', 5000),
          userId,
          propertyId,
          leadId
        }
      })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'APPOINTMENT_CREATED',
        entityType: 'Appointment',
        entityId: created.id,
        details: { status: created.status, startsAt: created.startsAt.toISOString(), propertyId: created.propertyId, leadId: created.leadId }
      })
      return created
    })
    const recipients = await organizationRecipientIds(prisma, organizationId, {
      roles: ['ADMIN', 'MANAGER'],
      includeUserIds: [userId],
      excludeUserId: userIdOf(req)
    })
    await notifyUsers(prisma, recipients, {
      organizationId,
      type: 'APPOINTMENT_CREATED',
      title: 'New appointment scheduled',
      message: appointment.title ? `${appointment.title} is scheduled for ${startsAt.toLocaleString()}.` : `An appointment is scheduled for ${startsAt.toLocaleString()}.`,
      entityType: 'Appointment',
      entityId: appointment.id,
      actionUrl: '/appointments',
      metadata: { startsAt: appointment.startsAt, propertyId: appointment.propertyId, leadId: appointment.leadId, userId: appointment.userId }
    })
    res.status(201).json({
      success: true,
      data: appointment,
      warnings: appointmentConflictWarnings(conflicts),
      message: 'Appointment created successfully'
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.appointment.findFirst({ where: { id, ...scope(organizationId) } })
    if (!existing) throw createError('Appointment not found', 404)

    const data: Prisma.AppointmentUpdateInput = {}
    const body = req.body as Record<string, unknown>
    if (body.title !== undefined) data.title = optionalString(body.title, 'title', 200)
    if (body.notes !== undefined) data.notes = optionalString(body.notes, 'notes', 5000)
    if (body.type !== undefined) data.type = enumValue(body.type, 'type', Object.values(AppointmentType))
    if (body.status !== undefined) data.status = enumValue(body.status, 'status', Object.values(AppointmentStatus))
    if (body.startsAt !== undefined) data.startsAt = dateValue(body.startsAt, 'startsAt', true)!
    const requestedEndsAt = body.endsAt !== undefined
      ? (body.endsAt === null ? null : dateValue(body.endsAt, 'endsAt')!)
      : undefined
    if (body.endsAt !== undefined) data.endsAt = requestedEndsAt

    const effectiveStartsAt = data.startsAt instanceof Date ? data.startsAt : existing.startsAt
    const effectiveEndsAt = requestedEndsAt !== undefined ? requestedEndsAt : existing.endsAt
    assertValidAppointmentWindow(effectiveStartsAt, effectiveEndsAt)

    if (['userId', 'propertyId', 'leadId'].some((key) => body[key] !== undefined)) {
      const userId = body.userId === undefined ? existing.userId : requiredString(body.userId, 'userId', 100)
      const propertyId = (body.propertyId === undefined ? existing.propertyId : optionalString(body.propertyId, 'propertyId', 100)) ?? undefined
      const leadId = (body.leadId === undefined ? existing.leadId : optionalString(body.leadId, 'leadId', 100)) ?? undefined
      await assertRelated(userId, propertyId, leadId, organizationId)
      data.user = { connect: { id: userId } }
      data.property = propertyId ? { connect: { id: propertyId } } : { disconnect: true }
      data.lead = leadId ? { connect: { id: leadId } } : { disconnect: true }
    }

    const conflicts = await findAppointmentConflicts(prisma, {
      organizationId,
      startsAt: effectiveStartsAt,
      endsAt: effectiveEndsAt,
      userId: body.userId === undefined ? existing.userId : String(body.userId),
      propertyId: body.propertyId === undefined
        ? existing.propertyId
        : (optionalString(body.propertyId, 'propertyId', 100) ?? null),
      excludeId: id
    })

    const appointment = await prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.update({ where: { id }, data })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'APPOINTMENT_UPDATED',
        entityType: 'Appointment',
        entityId: id,
        details: {
          before: {
            status: existing.status,
            startsAt: existing.startsAt.toISOString(),
            endsAt: existing.endsAt?.toISOString() ?? null,
            userId: existing.userId
          },
          after: {
            status: updated.status,
            startsAt: updated.startsAt.toISOString(),
            endsAt: updated.endsAt?.toISOString() ?? null,
            userId: updated.userId
          }
        }
      })
      return updated
    })
    const actorId = userIdOf(req)
    const recipients = await organizationRecipientIds(prisma, organizationId, {
      roles: ['ADMIN', 'MANAGER'],
      includeUserIds: [appointment.userId, existing.userId],
      excludeUserId: actorId
    })
    const changedStatus = existing.status !== appointment.status
    const rescheduled = existing.startsAt.getTime() !== appointment.startsAt.getTime() || (existing.endsAt?.getTime() || 0) !== (appointment.endsAt?.getTime() || 0)
    if (recipients.length && (changedStatus || rescheduled || existing.userId !== appointment.userId)) {
      await notifyUsers(prisma, recipients, {
        organizationId,
        type: changedStatus ? 'APPOINTMENT_STATUS_CHANGED' : rescheduled ? 'APPOINTMENT_RESCHEDULED' : 'APPOINTMENT_UPDATED',
        title: changedStatus ? 'Appointment status updated' : rescheduled ? 'Appointment rescheduled' : 'Appointment updated',
        message: appointment.title ? `${appointment.title} was ${changedStatus ? `marked ${appointment.status}` : 'updated'}.` : `Appointment was ${changedStatus ? `marked ${appointment.status}` : 'updated'}.`,
        entityType: 'Appointment',
        entityId: appointment.id,
        actionUrl: '/appointments',
        metadata: { beforeStatus: existing.status, afterStatus: appointment.status, beforeStartsAt: existing.startsAt, afterStartsAt: appointment.startsAt }
      })
    }
    res.json({
      success: true,
      data: appointment,
      warnings: appointmentConflictWarnings(conflicts),
      message: 'Appointment updated successfully'
    })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.appointment.findFirst({ where: { id, ...scope(organizationId) } })
    if (!existing) throw createError('Appointment not found', 404)
    await prisma.$transaction(async (tx) => {
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'APPOINTMENT_DELETED',
        entityType: 'Appointment',
        entityId: id,
        details: { status: existing.status }
      })
      await tx.appointment.delete({ where: { id } })
    })
    res.json({ success: true, message: 'Appointment deleted successfully' })
  } catch (error) {
    next(error)
  }
})

export default router
