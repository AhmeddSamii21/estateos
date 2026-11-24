import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { logAudit } from '../utils/audit'
import { MANAGEMENT_ROLES, organizationIdOf, userIdOf } from '../utils/scope'
import { assertUnitText, buildInventoryGrid, UNIT_STATUSES, unitStatus } from '../utils/unitInventory'

const router = Router()
router.use(authMiddleware)

const UNIT_SELECT = {
  id: true,
  title: true,
  referenceNumber: true,
  status: true,
  occupancyStatus: true,
  floors: true,
  projectName: true,
  buildingName: true,
  unitNumber: true,
  price: true,
  currency: true,
  bedrooms: true,
  type: true
} satisfies Prisma.PropertySelect

router.get('/units', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const project = typeof req.query.project === 'string' && req.query.project.trim() ? req.query.project.trim() : undefined
    const building = typeof req.query.building === 'string' && req.query.building.trim() ? req.query.building.trim() : undefined
    const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim().toUpperCase() : undefined
    if (status && !UNIT_STATUSES.includes(status as never)) throw createError('Invalid unit status', 400)
    const properties = await prisma.property.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(project ? { projectName: project } : {}),
        ...(building ? { buildingName: building } : {})
      },
      select: UNIT_SELECT,
      orderBy: [{ projectName: 'asc' }, { buildingName: 'asc' }, { floors: 'desc' }],
      take: 2000
    })
    const filtered = status ? properties.filter((property) => unitStatus(property) === status) : properties
    const grid = buildInventoryGrid(filtered, req.query.language === 'ar' ? 'ar' : 'en')
    res.json({ success: true, data: grid })
  } catch (error) {
    next(error)
  }
})

router.patch('/units/:id', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const current = await prisma.property.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { projectName: true, buildingName: true, unitNumber: true }
    })
    if (!current) throw createError('Property not found', 404)
    const data = {
      projectName: req.body?.projectName === undefined
        ? current.projectName
        : assertUnitText(req.body.projectName, 'projectName'),
      buildingName: req.body?.buildingName === undefined
        ? current.buildingName
        : assertUnitText(req.body.buildingName, 'buildingName'),
      unitNumber: req.body?.unitNumber === undefined
        ? current.unitNumber
        : assertUnitText(req.body.unitNumber, 'unitNumber', 40)
    }
    const property = await prisma.$transaction(async (tx) => {
      const saved = await tx.property.update({ where: { id }, data, select: UNIT_SELECT })
      await logAudit(tx, {
        userId: userIdOf(req),
        action: 'UNIT_INVENTORY_UPDATED',
        entityType: 'Property',
        entityId: id,
        details: data
      })
      return saved
    })
    res.json({ success: true, data: property })
  } catch (error) {
    next(error)
  }
})

router.get('/summary', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const properties = await prisma.property.findMany({
      where: { organizationId, deletedAt: null },
      select: UNIT_SELECT,
      take: 2000
    })
    const grid = buildInventoryGrid(properties)
    res.json({
      success: true,
      data: {
        total: grid.total,
        counts: grid.counts,
        projects: new Set(properties.map((property) => property.projectName).filter(Boolean)).size,
        buildings: new Set(properties.map((property) => property.buildingName).filter(Boolean)).size
      }
    })
  } catch (error) {
    next(error)
  }
})

export default router
