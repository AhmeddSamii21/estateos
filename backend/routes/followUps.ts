import { Router } from 'express'
import { FollowUpTaskStatus, Prisma, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { logAudit } from '../utils/audit'
import {
  assertChannel,
  assertTrigger,
  runFollowUpAutomation,
  taskScope,
  TRIGGER_LABELS
} from '../utils/followUpAutomation'
import { MANAGEMENT_ROLES, organizationIdOf, roleOf, userIdOf } from '../utils/scope'
import { booleanValue, dateValue, enumValue, numberValue, optionalString, requiredString } from '../utils/validation'

const router = Router()
router.use(authMiddleware)

const TASK_STATUSES = Object.values(FollowUpTaskStatus)
const EVALUATE_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.TEAM_LEAD]

interface RuleData {
  name: string
  nameAr: string | null
  trigger: ReturnType<typeof assertTrigger>
  conditionDays: number
  channel: ReturnType<typeof assertChannel>
  template: string
  templateAr: string | null
  priority: number
  isActive: boolean
}

function ruleBody(body: Record<string, unknown>, current?: RuleData): RuleData {
  const name = body.name === undefined ? current?.name : requiredString(body.name, 'name', 120)
  const template = body.template === undefined ? current?.template : requiredString(body.template, 'template', 500)
  if (!name) throw createError('name is required', 400)
  if (!template) throw createError('template is required', 400)
  return {
    name,
    nameAr: body.nameAr === undefined ? current?.nameAr ?? null : optionalString(body.nameAr, 'nameAr', 120) ?? null,
    trigger: body.trigger === undefined ? assertTrigger(current?.trigger) : assertTrigger(body.trigger),
    conditionDays: body.conditionDays === undefined
      ? current?.conditionDays ?? 3
      : numberValue(body.conditionDays, 'conditionDays', { min: 0, max: 365 }) ?? 3,
    channel: body.channel === undefined ? assertChannel(current?.channel ?? 'NOTIFICATION') : assertChannel(body.channel),
    template,
    templateAr: body.templateAr === undefined ? current?.templateAr ?? null : optionalString(body.templateAr, 'templateAr', 500) ?? null,
    priority: body.priority === undefined
      ? current?.priority ?? 0
      : numberValue(body.priority, 'priority', { min: -100, max: 100 }) ?? 0,
    isActive: body.isActive === undefined ? current?.isActive ?? true : booleanValue(body.isActive, 'isActive', true)
  }
}

router.get('/rules', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const trigger = req.query.trigger === undefined || req.query.trigger === ''
      ? undefined
      : assertTrigger(req.query.trigger)
    const rules = await prisma.followUpRule.findMany({
      where: { organizationId, deletedAt: null, ...(trigger ? { trigger } : {}) },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]
    })
    res.json({
      success: true,
      data: rules.map((rule) => ({ ...rule, label: TRIGGER_LABELS[rule.trigger][0], labelAr: TRIGGER_LABELS[rule.trigger][1] }))
    })
  } catch (error) {
    next(error)
  }
})

router.post('/rules', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const data = ruleBody(req.body || {})
    const rule = await prisma.$transaction(async (tx) => {
      const saved = await tx.followUpRule.create({ data: { organizationId, ...data } })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'FOLLOW_UP_RULE_CREATED',
        entityType: 'FollowUpRule',
        entityId: saved.id,
        details: { trigger: saved.trigger, channel: saved.channel }
      })
      return saved
    })
    res.status(201).json({ success: true, data: rule })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A rule with this name already exists', 409))
    }
    next(error)
  }
})

router.patch('/rules/:id', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const current = await prisma.followUpRule.findFirst({ where: { id, organizationId, deletedAt: null } })
    if (!current) throw createError('Follow-up rule not found', 404)
    const data = ruleBody(req.body || {}, current)
    const rule = await prisma.followUpRule.update({ where: { id }, data })
    res.json({ success: true, data: rule })
  } catch (error) {
    next(error)
  }
})

router.delete('/rules/:id', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const rule = await prisma.followUpRule.updateMany({
      where: { id, organizationId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false }
    })
    if (!rule.count) throw createError('Follow-up rule not found', 404)
    res.json({ success: true, data: { id }, message: 'Follow-up rule removed' })
  } catch (error) {
    next(error)
  }
})

router.get('/tasks', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const status = req.query.status === undefined || req.query.status === ''
      ? undefined
      : enumValue(req.query.status, 'status', TASK_STATUSES)
    const from = dateValue(req.query.from, 'from')
    const to = dateValue(req.query.to, 'to')
    const tasks = await prisma.followUpTask.findMany({
      where: {
        ...taskScope(organizationId, roleOf(req) || Role.AGENT, userIdOf(req)),
        ...(status ? { status } : {}),
        ...(from || to ? { dueAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {})
      },
      include: {
        rule: { select: { id: true, name: true, nameAr: true, trigger: true, channel: true } },
        lead: { select: { id: true, firstName: true, lastName: true } },
        deal: { select: { id: true, referenceNumber: true } }
      },
      orderBy: { dueAt: 'asc' },
      take: 500
    })
    res.json({ success: true, data: tasks })
  } catch (error) {
    next(error)
  }
})

router.patch('/tasks/:id/status', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const status = enumValue(req.body?.status, 'status', TASK_STATUSES)
    const current = await prisma.followUpTask.findFirst({
      where: { id, organizationId, ...taskScope(organizationId, roleOf(req) || Role.AGENT, userIdOf(req)) }
    })
    if (!current) throw createError('Follow-up task not found', 404)
    if (status === FollowUpTaskStatus.PENDING && current.status !== FollowUpTaskStatus.PENDING) {
      throw createError('Completed or cancelled tasks cannot be reopened', 400)
    }
    const task = await prisma.followUpTask.update({
      where: { id },
      data: {
        status,
        completedAt: status === FollowUpTaskStatus.COMPLETED ? new Date() : null,
        notes: req.body?.notes === undefined ? current.notes : optionalString(req.body.notes, 'notes', 1000)
      }
    })
    res.json({ success: true, data: task })
  } catch (error) {
    next(error)
  }
})

router.post('/evaluate', requireRole(EVALUATE_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const now = dateValue(req.body?.now, 'now') || new Date()
    const result = await runFollowUpAutomation(organizationId, now, userIdOf(req))
    res.json({ success: true, data: result })
  } catch (error) {
    next(error)
  }
})

router.get('/summary', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const scope = taskScope(organizationId, roleOf(req) || Role.AGENT, userIdOf(req))
    const [rules, pending, completed, overdue] = await Promise.all([
      prisma.followUpRule.count({ where: { organizationId, deletedAt: null, isActive: true } }),
      prisma.followUpTask.count({ where: { ...scope, status: FollowUpTaskStatus.PENDING } }),
      prisma.followUpTask.count({ where: { ...scope, status: FollowUpTaskStatus.COMPLETED } }),
      prisma.followUpTask.count({ where: { ...scope, status: FollowUpTaskStatus.PENDING, dueAt: { lt: new Date() } } })
    ])
    res.json({ success: true, data: { rules, pending, completed, overdue } })
  } catch (error) {
    next(error)
  }
})

export default router
