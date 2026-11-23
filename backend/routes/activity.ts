import { Router, type Request } from 'express'
import { authMiddleware } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { FINANCE_ROLES, organizationIdOf, userIdOf } from '../utils/scope'
import { dateValue, enumValue, optionalString, pagination, requiredString } from '../utils/validation'
import {
  ACTIVITY_ENTITY_TYPES,
  listEntityActivity,
  listGlobalActivity,
  type ActivityEntityType,
  type ActivityFilters,
  type ActivityViewer
} from '../services/activity'

const router = Router()
router.use(authMiddleware)

function viewerOf(req: Request): ActivityViewer {
  if (!req.user) throw createError('Authentication is required', 401)
  return { id: userIdOf(req), role: req.user.role, organizationId: organizationIdOf(req) }
}

function parseFilters(req: Request): ActivityFilters {
  const query = req.query as Record<string, unknown>
  const filters: ActivityFilters = {}

  if (query.entityType !== undefined) {
    filters.entityType = enumValue(query.entityType, 'entityType', ACTIVITY_ENTITY_TYPES)
  }
  if (query.action !== undefined) {
    const action = optionalString(query.action, 'action', 100)
    if (!action || !/^[A-Z][A-Z0-9_]*$/.test(action.toUpperCase())) {
      throw createError('Invalid action filter', 400)
    }
    filters.action = action.toUpperCase()
  }
  if (query.userId !== undefined) {
    const userId = optionalString(query.userId, 'userId', 200)
    if (!userId || !/^[A-Za-z0-9_-]+$/.test(userId)) {
      throw createError('Invalid userId filter', 400)
    }
    filters.userId = userId
  }
  filters.from = dateValue(query.from, 'from')
  filters.to = dateValue(query.to, 'to')
  if (filters.from && filters.to && filters.from > filters.to) {
    throw createError('from must be before to', 400)
  }
  return filters
}

function assertFinanceAccess(viewer: ActivityViewer, type: ActivityEntityType): void {
  if (['Payment', 'Expense', 'Commission'].includes(type) && !FINANCE_ROLES.includes(viewer.role)) {
    throw createError('Insufficient permissions', 403)
  }
}

router.get('/', async (req, res, next) => {
  try {
    const viewer = viewerOf(req)
    const filters = parseFilters(req)
    if (filters.entityType) assertFinanceAccess(viewer, filters.entityType)
    const { limit } = pagination(req.query as Record<string, unknown>)
    const cursor = optionalString(req.query.cursor, 'cursor', 500)
    const result = await listGlobalActivity(viewer, filters, { limit, cursor })
    res.json({ success: true, data: result.data, nextCursor: result.nextCursor })
  } catch (error) {
    next(error)
  }
})

router.get('/:entityType/:entityId', async (req, res, next) => {
  try {
    const viewer = viewerOf(req)
    const type = enumValue(req.params.entityType, 'entityType', ACTIVITY_ENTITY_TYPES)
    const entityId = requiredString(req.params.entityId, 'entityId', 200)
    assertFinanceAccess(viewer, type)
    const filters = parseFilters(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const result = await listEntityActivity(viewer, type, entityId, filters, { page, limit, skip })
    res.json({ success: true, data: result.data, pagination: result.pagination })
  } catch (error) {
    next(error)
  }
})

export default router
