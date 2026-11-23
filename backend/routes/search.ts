import { Router, type Request, type Response, type NextFunction } from 'express'
import { prisma } from '../prisma'
import { createError } from '../middleware/errorHandler'
import { authMiddleware } from '../middleware/auth'
import { organizationIdOf, roleOf, userIdOf } from '../utils/scope'
import { buildGlobalSearchQuery } from '../utils/search'
import { numberValue, optionalString } from '../utils/validation'

const router = Router()
router.use(authMiddleware)

router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const organizationId = organizationIdOf(req)
    const role = roleOf(req)
    if (!role) throw createError('Authentication is required', 401)

    const query = optionalString(req.query.q, 'q', 200) ?? ''
    const page = numberValue(req.query.page, 'page', { min: 1 }) ?? 1
    const limit = numberValue(req.query.limit, 'limit', { min: 1, max: 100 }) ?? 20
    const skip = (page - 1) * limit

    const searchQuery = buildGlobalSearchQuery(organizationId, query, { id: userIdOf(req), role })

    const [
      properties,
      owners,
      leads,
      deals,
      documents,
      propertyTotal,
      ownerTotal,
      leadTotal,
      dealTotal,
      documentTotal
    ] = await Promise.all([
      prisma.property.findMany({
        where: searchQuery.properties.where,
        select: searchQuery.properties.select,
        orderBy: searchQuery.properties.orderBy,
        skip,
        take: limit
      }),
      prisma.owner.findMany({
        where: searchQuery.owners.where,
        select: searchQuery.owners.select,
        orderBy: searchQuery.owners.orderBy,
        skip,
        take: limit
      }),
      prisma.lead.findMany({
        where: searchQuery.leads.where,
        select: searchQuery.leads.select,
        orderBy: searchQuery.leads.orderBy,
        skip,
        take: limit
      }),
      prisma.deal.findMany({
        where: searchQuery.deals.where,
        select: searchQuery.deals.select,
        orderBy: searchQuery.deals.orderBy,
        skip,
        take: limit
      }),
      prisma.document.findMany({
        where: searchQuery.documents.where,
        select: searchQuery.documents.select,
        orderBy: searchQuery.documents.orderBy,
        skip,
        take: limit
      }),
      prisma.property.count({ where: searchQuery.properties.where }),
      prisma.owner.count({ where: searchQuery.owners.where }),
      prisma.lead.count({ where: searchQuery.leads.where }),
      prisma.deal.count({ where: searchQuery.deals.where }),
      prisma.document.count({ where: searchQuery.documents.where })
    ])

    const results = {
      properties: properties.map((p) => ({
        id: p.id,
        title: p.title,
        type: 'property',
        route: `/properties/${p.id}`,
        details: {
          city: p.city,
          address: p.address,
          price: p.price.toString(),
          referenceNumber: p.referenceNumber,
          type: p.type
        }
      })),
      owners: owners.map((o) => ({
        id: o.id,
        title: `${o.firstName || ''} ${o.lastName || ''} ${o.companyName || ''}`.trim(),
        type: 'owner',
        route: `/owners/${o.id}`,
        details: {
          name: `${o.firstName || ''} ${o.lastName || ''} ${o.companyName || ''}`.trim(),
          email: o.email ?? undefined,
          phone: o.phone ?? undefined
        }
      })),
      leads: leads.map((l) => ({
        id: l.id,
        title: `${l.firstName || ''} ${l.lastName || ''}`.trim(),
        type: 'lead',
        route: `/leads/${l.id}`,
        details: {
          name: `${l.firstName || ''} ${l.lastName || ''}`.trim(),
          email: l.email ?? undefined,
          phone: l.phone ?? undefined,
          status: l.status
        }
      })),
      deals: deals.map((d) => ({
        id: d.id,
        title: d.referenceNumber || `Deal ${d.id.slice(0, 8)}`,
        type: 'deal',
        route: `/deals/${d.id}`,
        details: {
          referenceNumber: d.referenceNumber ?? undefined,
          amount: d.amount ? d.amount.toString() : undefined,
          status: d.status,
          type: d.type
        }
      })),
      documents: documents.map((doc) => ({
        id: doc.id,
        title: doc.name,
        type: 'document',
        route: `/documents/${doc.id}`,
        details: {
          name: doc.name,
          category: doc.category,
          originalName: doc.originalName
        }
      }))
    }

    const total = propertyTotal + ownerTotal + leadTotal + dealTotal + documentTotal

    res.json({
      success: true,
      data: results,
      total,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    next(error)
  }
})

export default router
