import { Router } from 'express'
import { MaintenancePriority, MaintenanceStatus, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { MANAGEMENT_ROLES, organizationIdOf, userIdOf } from '../utils/scope'
import { dateValue, enumValue, optionalString, pagination, requiredString } from '../utils/validation'
import { parseMoney } from '../utils/money'
import { logAudit, logPropertyActivity } from '../utils/audit'
import { notifyUsers, organizationRecipientIds } from '../services/notifications'
import {
  linkedExpenseSummary,
  maintenanceExpenseData,
  maintenanceExpenseWhere,
  shouldRecordMaintenanceExpense
} from '../utils/maintenanceExpense'

const router = Router()
router.use(authMiddleware)

const linkedExpenseSelect = { id: true, status: true, amount: true, currency: true } as const

function withExpenseSummary<T extends { expense?: { id: string; status: string; amount: Prisma.Decimal; currency: string } | null }>(row: T) {
  return { ...row, ...linkedExpenseSummary(row.expense) }
}

const TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  [MaintenanceStatus.OPEN]: [MaintenanceStatus.IN_PROGRESS, MaintenanceStatus.CANCELLED],
  [MaintenanceStatus.IN_PROGRESS]: [MaintenanceStatus.COMPLETED, MaintenanceStatus.CANCELLED],
  [MaintenanceStatus.COMPLETED]: [],
  [MaintenanceStatus.CANCELLED]: []
}

function canManage(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'AGENT'
}

async function assertRelations(propertyId: string, assignedToId: string | undefined, organizationId: string) {
  const [property, user] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId, organizationId, deletedAt: null }, select: { id: true } }),
    assignedToId
      ? prisma.user.findFirst({ where: { id: assignedToId, organizationId, deletedAt: null }, select: { id: true } })
      : Promise.resolve(null)
  ])
  if (!property) throw createError('Property not found', 404)
  if (assignedToId && !user) throw createError('Assigned employee not found', 404)
}

router.get('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where: Prisma.MaintenanceRequestWhereInput = { organizationId, deletedAt: null }
    if (req.query.status) where.status = enumValue(req.query.status, 'status', Object.values(MaintenanceStatus))
    if (req.query.priority) where.priority = enumValue(req.query.priority, 'priority', Object.values(MaintenancePriority))
    if (req.query.propertyId) where.propertyId = String(req.query.propertyId)
    if (req.user?.role === 'AGENT') where.assignedToId = userIdOf(req)
    const [total, requests] = await Promise.all([
      prisma.maintenanceRequest.count({ where }),
      prisma.maintenanceRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          property: { select: { id: true, title: true, referenceNumber: true } },
          assignedTo: { select: { id: true, email: true, firstName: true } },
          createdBy: { select: { id: true, email: true, firstName: true } },
          expense: { select: linkedExpenseSelect }
        }
      })
    ])
    res.json({ success: true, data: requests.map(withExpenseSummary), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error) {
    next(error)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const where: Prisma.MaintenanceRequestWhereInput = { id: String(req.params.id), organizationId, deletedAt: null }
    if (req.user?.role === 'AGENT') where.assignedToId = userIdOf(req)
    const request = await prisma.maintenanceRequest.findFirst({
      where,
      include: {
        property: true,
        assignedTo: { select: { id: true, email: true, firstName: true } },
        createdBy: { select: { id: true, email: true, firstName: true } },
        expense: { select: linkedExpenseSelect }
      }
    })
    if (!request) throw createError('Maintenance request not found', 404)
    res.json({ success: true, data: withExpenseSummary(request) })
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw createError('Insufficient permissions', 403)
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const propertyId = requiredString(req.body?.propertyId, 'propertyId', 100)
    const assignedToId = optionalString(req.body?.assignedToId, 'assignedToId', 100)
    await assertRelations(propertyId, assignedToId, organizationId)

    const request = await prisma.$transaction(async (tx) => {
      const created = await tx.maintenanceRequest.create({
        data: {
          organizationId,
          propertyId,
          title: requiredString(req.body?.title, 'title', 200),
          description: optionalString(req.body?.description, 'description', 5000),
          priority: enumValue(req.body?.priority, 'priority', Object.values(MaintenancePriority), MaintenancePriority.MEDIUM),
          assignedToId,
          createdById: userId,
          cost: parseMoney(req.body?.cost, 'cost', { min: 0 }),
          currency: (optionalString(req.body?.currency, 'currency', 3) || 'USD').toUpperCase(),
          dueAt: dateValue(req.body?.dueAt, 'dueAt'),
          notes: optionalString(req.body?.notes, 'notes', 5000)
        }
      })
      await logPropertyActivity(tx, { propertyId, userId, action: 'MAINTENANCE_CREATED', details: { requestId: created.id } })
      await logAudit(tx, { userId, action: 'MAINTENANCE_CREATED', entityType: 'MaintenanceRequest', entityId: created.id })
      const recipients = await organizationRecipientIds(tx, organizationId, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: assignedToId ? [assignedToId] : [],
        excludeUserId: userId
      })
      await notifyUsers(tx, recipients, {
        organizationId,
        type: 'MAINTENANCE_CREATED',
        title: 'Maintenance request created',
        message: `${created.title} was created for a property.`,
        entityType: 'MaintenanceRequest',
        entityId: created.id,
        actionUrl: '/maintenance',
        metadata: { propertyId, assignedToId, priority: created.priority }
      })
      return created
    })
    res.status(201).json({ success: true, data: request, message: 'Maintenance request created successfully' })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw createError('Insufficient permissions', 403)
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.maintenanceRequest.findFirst({ where: { id, organizationId, deletedAt: null } })
    if (!existing) throw createError('Maintenance request not found', 404)
    const existingExpense = await prisma.expense.findFirst({
      where: maintenanceExpenseWhere(id),
      select: linkedExpenseSelect
    })

    const isAgent = req.user?.role === 'AGENT'
    if (isAgent && existing.assignedToId !== userId) {
      throw createError('Insufficient permissions to update this maintenance request', 403)
    }
    const body = req.body as Record<string, unknown>
    if (isAgent && (body.cost !== undefined || body.currency !== undefined || body.assignedToId !== undefined)) {
      throw createError('Only management can change maintenance cost or assignment', 403)
    }
    const data: Prisma.MaintenanceRequestUpdateInput = {}
    if (body.title !== undefined) data.title = requiredString(body.title, 'title', 200)
    if (body.description !== undefined) data.description = optionalString(body.description, 'description', 5000)
    if (body.notes !== undefined) data.notes = optionalString(body.notes, 'notes', 5000)
    if (body.priority !== undefined) data.priority = enumValue(body.priority, 'priority', Object.values(MaintenancePriority))
    if (body.cost !== undefined) data.cost = parseMoney(body.cost, 'cost', { min: 0 })
    if (body.currency !== undefined) data.currency = (optionalString(body.currency, 'currency', 3) || 'USD').toUpperCase()
    if (body.dueAt !== undefined) data.dueAt = dateValue(body.dueAt, 'dueAt')

    let status = existing.status
    if (body.status !== undefined) {
      status = enumValue(body.status, 'status', Object.values(MaintenanceStatus))
      if (status !== existing.status && !TRANSITIONS[existing.status].includes(status)) {
        throw createError(`Invalid maintenance status transition: ${existing.status} to ${status}`, 400)
      }
      data.status = status
      if (status === MaintenanceStatus.COMPLETED) data.completedAt = new Date()
    }

    if (body.assignedToId !== undefined) {
      const assignedToId = optionalString(body.assignedToId, 'assignedToId', 100)
      await assertRelations(existing.propertyId, assignedToId, organizationId)
      data.assignedTo = assignedToId ? { connect: { id: assignedToId } } : { disconnect: true }
    }

    const request = await prisma.$transaction(async (tx) => {
      const updated = await tx.maintenanceRequest.update({ where: { id }, data })
      await logPropertyActivity(tx, {
        propertyId: existing.propertyId,
        userId,
        action: status !== existing.status ? 'MAINTENANCE_STATUS_CHANGED' : 'MAINTENANCE_UPDATED',
        details: { requestId: id, before: existing.status, after: status }
      })
      await logAudit(tx, { userId, action: 'MAINTENANCE_UPDATED', entityType: 'MaintenanceRequest', entityId: id, details: { before: existing.status, after: status } })

      const costForExpense = updated.cost
      const currencyForExpense = updated.currency
      if (shouldRecordMaintenanceExpense({
        status,
        cost: costForExpense,
        recordExpense: body.recordExpense,
        linkedExpenseId: existingExpense?.id
      })) {
        const expense = await tx.expense.create({
          data: maintenanceExpenseData({
            id,
            propertyId: existing.propertyId,
            title: updated.title,
            cost: costForExpense,
            currency: currencyForExpense,
            completedAt: updated.completedAt || new Date(),
            assignedToId: updated.assignedToId,
            notes: updated.notes
          })
        })
        await logAudit(tx, { userId, action: 'MAINTENANCE_EXPENSE_CREATED', entityType: 'Expense', entityId: expense.id, details: { maintenanceRequestId: id, amount: expense.amount.toString(), currency: expense.currency } })
      }

      const linkedExpense = await tx.expense.findFirst({ where: maintenanceExpenseWhere(id), select: linkedExpenseSelect })
      const recipients = await organizationRecipientIds(tx, organizationId, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: [updated.assignedToId || '', existing.assignedToId || ''],
        excludeUserId: userId
      })
      const reassigned = existing.assignedToId !== updated.assignedToId
      if (recipients.length && (status !== existing.status || reassigned || body.priority !== undefined)) {
        await notifyUsers(tx, recipients, {
          organizationId,
          type: status !== existing.status ? 'MAINTENANCE_STATUS_CHANGED' : reassigned ? 'MAINTENANCE_ASSIGNED' : 'MAINTENANCE_UPDATED',
          title: status !== existing.status ? 'Maintenance status updated' : reassigned ? 'Maintenance reassigned' : 'Maintenance updated',
          message: `${updated.title} ${status !== existing.status ? `is now ${status}` : reassigned ? 'was reassigned' : 'was updated'}.`,
          entityType: 'MaintenanceRequest',
          entityId: id,
          actionUrl: '/maintenance',
          metadata: { beforeStatus: existing.status, afterStatus: status, beforeAssignee: existing.assignedToId, afterAssignee: updated.assignedToId }
        })
      }
      return withExpenseSummary({ ...updated, expense: linkedExpense })
    })
    res.json({ success: true, data: request, message: 'Maintenance request updated successfully' })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.maintenanceRequest.findFirst({ where: { id, organizationId, deletedAt: null } })
    if (!existing) throw createError('Maintenance request not found', 404)
    await prisma.$transaction(async (tx) => {
      await tx.maintenanceRequest.update({ where: { id }, data: { deletedAt: new Date() } })
      await logAudit(tx, { userId, action: 'MAINTENANCE_ARCHIVED', entityType: 'MaintenanceRequest', entityId: id })
    })
    res.json({ success: true, message: 'Maintenance request archived successfully' })
  } catch (error) {
    next(error)
  }
})

export default router
