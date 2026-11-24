import { Router, type NextFunction, type Request, type Response } from 'express'
import { Role, WebhookDeliveryStatus, type WebhookEndpoint } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { organizationIdOf, userIdOf } from '../utils/scope'
import { assertFound, booleanValue, enumValue, pagination } from '../utils/validation'
import { logAudit } from '../utils/audit'
import { WEBHOOK_EVENT_CODES, parseWebhookEvents } from '../utils/webhookEvents'
import { generateWebhookSecret } from '../utils/webhookSignature'
import { validateWebhookUrl } from '../utils/webhookUrl'
import { retryWebhookDelivery } from '../services/webhookDispatcher'

const router = Router()
router.use(authMiddleware)
router.use(requireRole([Role.ADMIN]))

/** Never exposes the stored secret hash or the raw signing secret. */
function endpointView(endpoint: WebhookEndpoint) {
  return {
    id: endpoint.id,
    organizationId: endpoint.organizationId,
    url: endpoint.url,
    events: endpoint.events,
    isActive: endpoint.isActive,
    createdById: endpoint.createdById,
    updatedById: endpoint.updatedById,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
    deletedAt: endpoint.deletedAt
  }
}

function validUrlOrThrow(value: unknown): Promise<string> {
  return validateWebhookUrl(value).catch((error: unknown) => {
    throw createError(error instanceof Error ? error.message : 'Invalid webhook URL', 400)
  })
}

function eventsOrThrow(value: unknown) {
  try {
    return parseWebhookEvents(value)
  } catch (error) {
    throw createError(error instanceof Error ? error.message : 'Invalid webhook events', 400)
  }
}

router.get('/endpoints', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = organizationIdOf(req)
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' }
    })
    res.json({ success: true, data: endpoints.map(endpointView) })
  } catch (error) {
    next(error)
  }
})

router.post('/endpoints', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const url = await validUrlOrThrow(req.body?.url)
    const events = eventsOrThrow(req.body?.events)
    const isActive = booleanValue(req.body?.isActive, 'isActive', true)
    const { secret, secretHash } = generateWebhookSecret()

    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        organizationId,
        url,
        events,
        isActive,
        secretHash,
        createdById: userId,
        updatedById: userId
      }
    })
    await logAudit(prisma, {
      userId,
      action: 'WEBHOOK_ENDPOINT_CREATED',
      entityType: 'WebhookEndpoint',
      entityId: endpoint.id,
      details: { events, isActive }
    })
    // The raw secret is intentionally only ever returned in this response.
    res.status(201).json({ success: true, data: endpointView(endpoint), secret })
  } catch (error) {
    next(error)
  }
})

router.patch('/endpoints/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = assertFound(
      await prisma.webhookEndpoint.findFirst({ where: { id, organizationId, deletedAt: null } }),
      'Webhook endpoint'
    )

    const data: { url?: string; events?: string[]; isActive?: boolean; updatedById: string } = { updatedById: userId }
    if (req.body?.url !== undefined) data.url = await validUrlOrThrow(req.body.url)
    if (req.body?.events !== undefined) data.events = eventsOrThrow(req.body.events)
    if (req.body?.isActive !== undefined) data.isActive = booleanValue(req.body.isActive, 'isActive', existing.isActive)

    const endpoint = await prisma.webhookEndpoint.update({ where: { id: existing.id }, data })
    const deactivated = data.isActive === false && existing.isActive
    await logAudit(prisma, {
      userId,
      action: deactivated ? 'WEBHOOK_ENDPOINT_DEACTIVATED' : 'WEBHOOK_ENDPOINT_UPDATED',
      entityType: 'WebhookEndpoint',
      entityId: endpoint.id,
      details: { fields: Object.keys(data).filter((field) => field !== 'updatedById'), isActive: endpoint.isActive }
    })
    res.json({ success: true, data: endpointView(endpoint) })
  } catch (error) {
    next(error)
  }
})

router.delete('/endpoints/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = assertFound(
      await prisma.webhookEndpoint.findFirst({ where: { id, organizationId, deletedAt: null } }),
      'Webhook endpoint'
    )
    await prisma.webhookEndpoint.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false, updatedById: userId }
    })
    await logAudit(prisma, {
      userId,
      action: 'WEBHOOK_ENDPOINT_DEACTIVATED',
      entityType: 'WebhookEndpoint',
      entityId: existing.id,
      details: { softDelete: true }
    })
    res.json({ success: true, message: 'Webhook endpoint deactivated' })
  } catch (error) {
    next(error)
  }
})

router.get('/deliveries', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const status = req.query.status === undefined || req.query.status === ''
      ? undefined
      : enumValue(req.query.status, 'status', Object.values(WebhookDeliveryStatus))
    const event = req.query.event === undefined || req.query.event === ''
      ? undefined
      : enumValue(req.query.event, 'event', WEBHOOK_EVENT_CODES)

    const where = { organizationId, ...(status ? { status } : {}), ...(event ? { event } : {}) }
    const [deliveries, total] = await Promise.all([
      prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.webhookDelivery.count({ where })
    ])
    res.json({ success: true, data: deliveries, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error) {
    next(error)
  }
})

router.get('/deliveries/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = organizationIdOf(req)
    const delivery = assertFound(
      await prisma.webhookDelivery.findFirst({ where: { id: String(req.params.id), organizationId } }),
      'Webhook delivery'
    )
    res.json({ success: true, data: delivery })
  } catch (error) {
    next(error)
  }
})

router.post('/deliveries/:id/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const retried = assertFound(await retryWebhookDelivery(id, organizationId), 'Webhook delivery')
    await logAudit(prisma, {
      userId,
      action: 'WEBHOOK_DELIVERY_RETRY',
      entityType: 'WebhookDelivery',
      entityId: retried.id,
      details: { event: retried.event, attempt: retried.attempt }
    })
    res.json({ success: true, data: retried })
  } catch (error) {
    next(error)
  }
})

export default router
