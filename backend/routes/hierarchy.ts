import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { MANAGEMENT_ROLES, organizationIdOf } from '../utils/scope'
import { booleanValue, optionalString, pagination, requiredString } from '../utils/validation'

const router = Router()
router.use(authMiddleware)
router.use(requireRole(MANAGEMENT_ROLES))

function branchPayload(branch: {
  id: string
  organizationId: string
  name: string
  nameAr: string | null
  code: string | null
  isActive: boolean
}) {
  return {
    id: branch.id,
    organizationId: branch.organizationId,
    name: branch.name,
    nameAr: branch.nameAr,
    code: branch.code,
    isActive: branch.isActive
  }
}

function teamPayload(team: {
  id: string
  organizationId: string
  branchId: string | null
  name: string
  nameAr: string | null
  leaderId: string | null
  isActive: boolean
}) {
  return {
    id: team.id,
    organizationId: team.organizationId,
    branchId: team.branchId,
    name: team.name,
    nameAr: team.nameAr,
    leaderId: team.leaderId,
    isActive: team.isActive
  }
}

async function assertBranch(organizationId: string, branchId: string | undefined) {
  if (!branchId) return
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId, deletedAt: null },
    select: { id: true }
  })
  if (!branch) throw createError('Branch not found', 404)
}

router.get('/branches', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where = { organizationId, deletedAt: null }
    const [total, branches] = await Promise.all([
      prisma.branch.count({ where }),
      prisma.branch.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } })
    ])
    res.json({
      success: true,
      data: branches.map(branchPayload),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    next(error)
  }
})

router.post('/branches', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const data = {
      organizationId,
      name: requiredString(req.body?.name, 'name', 120),
      nameAr: optionalString(req.body?.nameAr, 'nameAr', 120),
      code: optionalString(req.body?.code, 'code', 40)?.toUpperCase(),
      isActive: booleanValue(req.body?.isActive, 'isActive', true)
    }
    const branch = await prisma.branch.create({ data })
    res.status(201).json({ success: true, data: branchPayload(branch), message: 'Branch created successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A branch with this name already exists', 409))
    }
    next(error)
  }
})

router.patch('/branches/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const current = await prisma.branch.findFirst({ where: { id, organizationId, deletedAt: null } })
    if (!current) throw createError('Branch not found', 404)
    const data: Prisma.BranchUpdateInput = {}
    if (req.body?.name !== undefined) data.name = requiredString(req.body.name, 'name', 120)
    if (req.body?.nameAr !== undefined) data.nameAr = optionalString(req.body.nameAr, 'nameAr', 120)
    if (req.body?.code !== undefined) data.code = optionalString(req.body.code, 'code', 40)?.toUpperCase()
    if (req.body?.isActive !== undefined) data.isActive = booleanValue(req.body.isActive, 'isActive')
    const branch = await prisma.branch.update({ where: { id }, data })
    res.json({ success: true, data: branchPayload(branch), message: 'Branch updated successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A branch with this name already exists', 409))
    }
    next(error)
  }
})

router.get('/teams', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const where = { organizationId, deletedAt: null }
    const [total, teams] = await Promise.all([
      prisma.team.count({ where }),
      prisma.team.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } })
    ])
    res.json({
      success: true,
      data: teams.map(teamPayload),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    next(error)
  }
})

router.post('/teams', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const branchId = optionalString(req.body?.branchId, 'branchId', 100)
    const leaderId = optionalString(req.body?.leaderId, 'leaderId', 100)
    await assertBranch(organizationId, branchId)
    if (leaderId) {
      const leader = await prisma.user.findFirst({
        where: { id: leaderId, organizationId, deletedAt: null },
        select: { id: true }
      })
      if (!leader) throw createError('Team leader not found', 404)
    }
    const team = await prisma.team.create({
      data: {
        organizationId,
        branchId,
        name: requiredString(req.body?.name, 'name', 120),
        nameAr: optionalString(req.body?.nameAr, 'nameAr', 120),
        leaderId,
        isActive: booleanValue(req.body?.isActive, 'isActive', true)
      }
    })
    res.status(201).json({ success: true, data: teamPayload(team), message: 'Team created successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A team with this name already exists', 409))
    }
    next(error)
  }
})

router.patch('/teams/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const current = await prisma.team.findFirst({ where: { id, organizationId, deletedAt: null } })
    if (!current) throw createError('Team not found', 404)
    const data: Prisma.TeamUpdateInput = {}
    if (req.body?.name !== undefined) data.name = requiredString(req.body.name, 'name', 120)
    if (req.body?.nameAr !== undefined) data.nameAr = optionalString(req.body.nameAr, 'nameAr', 120)
    if (req.body?.branchId !== undefined) {
      const branchId = optionalString(req.body.branchId, 'branchId', 100)
      await assertBranch(organizationId, branchId)
      data.branch = branchId ? { connect: { id: branchId } } : { disconnect: true }
    }
    if (req.body?.leaderId !== undefined) {
      const leaderId = optionalString(req.body.leaderId, 'leaderId', 100)
      if (leaderId) {
        const leader = await prisma.user.findFirst({
          where: { id: leaderId, organizationId, deletedAt: null },
          select: { id: true }
        })
        if (!leader) throw createError('Team leader not found', 404)
      }
      data.leader = leaderId ? { connect: { id: leaderId } } : { disconnect: true }
    }
    if (req.body?.isActive !== undefined) data.isActive = booleanValue(req.body.isActive, 'isActive')
    const team = await prisma.team.update({ where: { id }, data })
    res.json({ success: true, data: teamPayload(team), message: 'Team updated successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A team with this name already exists', 409))
    }
    next(error)
  }
})

export default router
