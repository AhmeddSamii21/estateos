import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { organizationIdOf, userIdOf } from '../utils/scope'
import { propertyVisibility, teamVisibility } from '../utils/visibility'
import { numberValue } from '../utils/validation'
import {
  buildAvailabilityMap,
  MAP_STATUSES,
  type MapFilters,
  type MapPropertyLike
} from '../utils/liveMap'

const router = Router()
router.use(authMiddleware)

const MAP_SELECT = {
  id: true,
  title: true,
  referenceNumber: true,
  status: true,
  occupancyStatus: true,
  floors: true,
  projectName: true,
  buildingName: true,
  unitNumber: true,
  city: true,
  cityArea: true,
  latitude: true,
  longitude: true,
  unitLatitude: true,
  unitLongitude: true,
  mapX: true,
  mapY: true,
  masterplanImageUrl: true,
  price: true,
  currency: true,
  bedrooms: true,
  area: true,
  type: true
} satisfies Prisma.PropertySelect

function queryString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

/**
 * Tenant-scoped live availability. The organization id always comes from the
 * verified token; branch/team visibility is resolved from the database.
 */
router.get('/availability', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const status = queryString(req.query.status)?.toUpperCase()
    if (status && !MAP_STATUSES.includes(status as (typeof MAP_STATUSES)[number])) {
      throw createError('Invalid map status', 400)
    }
    const filters: MapFilters = {
      project: queryString(req.query.project),
      status,
      type: queryString(req.query.type)?.toUpperCase(),
      minPrice: numberValue(req.query.minPrice, 'minPrice', { min: 0 }),
      maxPrice: numberValue(req.query.maxPrice, 'maxPrice', { min: 0 })
    }

    const where: Prisma.PropertyWhereInput = { organizationId, deletedAt: null }
    if (req.user?.role === 'AGENT') where.assignedAgentId = userIdOf(req)
    const visibilityContext = await teamVisibility(req)
    if (visibilityContext) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), propertyVisibility(visibilityContext)]
    }

    const properties = await prisma.property.findMany({
      where,
      select: MAP_SELECT,
      orderBy: [{ projectName: 'asc' }, { buildingName: 'asc' }, { unitNumber: 'asc' }],
      take: 2000
    })
    const result = buildAvailabilityMap(properties as MapPropertyLike[], req.query.language === 'ar' ? 'ar' : 'en', filters)
    res.json({
      success: true,
      data: {
        ...result,
        generatedAt: new Date().toISOString(),
        filters: {
          project: filters.project || null,
          status: filters.status || null,
          type: filters.type || null,
          minPrice: filters.minPrice ?? null,
          maxPrice: filters.maxPrice ?? null
        }
      }
    })
  } catch (error) {
    next(error)
  }
})

export default router
