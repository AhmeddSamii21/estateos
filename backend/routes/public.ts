import { Router } from 'express'
import { prisma } from '../prisma'
import { createError } from '../middleware/errorHandler'
import { isShareExpired, isValidShareToken } from '../utils/share'
import { clientPortalKind } from '../utils/clientPortal'
import { serializeAttachment } from '../utils/propertyAttachments'
import { readDocument } from '../storage/local'
import { sanitizeOriginalName } from '../utils/files'

const router = Router()

router.get('/properties/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim()
    if (!isValidShareToken(token)) throw createError('Invalid share token', 404)
    const property = await prisma.property.findFirst({
      where: {
        publicShareToken: token,
        publicShareEnabled: true,
        isActive: true,
        deletedAt: null
      },
      select: {
        id: true,
        referenceNumber: true,
        title: true,
        description: true,
        type: true,
        status: true,
        classification: true,
        address: true,
        city: true,
        state: true,
        country: true,
        postalCode: true,
        latitude: true,
        longitude: true,
        area: true,
        areaUnit: true,
        bedrooms: true,
        bathrooms: true,
        floors: true,
        yearBuilt: true,
        condition: true,
        price: true,
        currency: true,
        negotiable: true,
        availableFrom: true,
        publicShareExpiresAt: true,
        images: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            size: true,
            caption: true,
            isPrimary: true,
            sortOrder: true
          }
        },
        documents: {
          where: { deletedAt: null, kind: { in: ['FLOORPLAN', 'BROCHURE'] } },
          orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            name: true,
            url: true,
            kind: true,
            mimeType: true,
            originalName: true,
            size: true,
            sortOrder: true,
            storageKey: true
          }
        }
      }
    })
    if (!property || isShareExpired(property.publicShareExpiresAt)) {
      throw createError('Shared property not found', 404)
    }
    // Expose strictly client-safe fields only.
    res.json({
      success: true,
      data: {
        referenceNumber: property.referenceNumber,
        title: property.title,
        description: property.description,
        type: property.type,
        status: property.status,
        classification: property.classification,
        address: property.address,
        city: property.city,
        state: property.state,
        country: property.country,
        postalCode: property.postalCode,
        latitude: property.latitude,
        longitude: property.longitude,
        area: property.area,
        areaUnit: property.areaUnit,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        floors: property.floors,
        yearBuilt: property.yearBuilt,
        condition: property.condition,
        price: property.price,
        currency: property.currency,
        negotiable: property.negotiable,
        availableFrom: property.availableFrom,
        shareExpiresAt: property.publicShareExpiresAt,
        images: property.images.map((img) => ({
          id: img.id,
          originalName: img.originalName,
          mimeType: img.mimeType,
          size: img.size,
          caption: img.caption,
          isPrimary: img.isPrimary,
          sortOrder: img.sortOrder,
          contentUrl: `/api/public/properties/${encodeURIComponent(token)}/images/${encodeURIComponent(img.id)}/content`
        })),
        attachments: property.documents.map((attachment) => serializeAttachment(
          attachment,
          attachment.storageKey
            ? `/api/public/properties/${encodeURIComponent(token)}/attachments/${encodeURIComponent(attachment.id)}/content`
            : null
        ))
      }
    })
  } catch (error) {
    next(error)
  }
})

router.get('/properties/:token/images/:imageId/content', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim()
    const imageId = String(req.params.imageId || '')
    const property = await prisma.property.findFirst({
      where: { publicShareToken: token, publicShareEnabled: true, isActive: true, deletedAt: null },
      select: { id: true, publicShareExpiresAt: true }
    })
    if (!isValidShareToken(token) || !property || isShareExpired(property.publicShareExpiresAt)) throw createError('Shared property not found', 404)
    const image = await prisma.propertyImage.findFirst({
      where: { id: imageId, propertyId: property.id, deletedAt: null },
      select: { storageKey: true, mimeType: true, originalName: true }
    })
    if (!image || !image.storageKey) throw createError('Image not found', 404)
    const { readPropertyImage } = await import('../storage/local.js')
    const { sanitizeOriginalName } = await import('../utils/files.js')
    const buffer = await readPropertyImage(image.storageKey)
    res.setHeader('Content-Type', image.mimeType || 'application/octet-stream')
    res.setHeader('Content-Length', String(buffer.length))
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeOriginalName(image.originalName || 'image')}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(buffer)
  } catch (error) {
    next(error)
  }
})

// Package 14: public floorplans/brochures for the /p/:shareToken page. Only
// client-safe fields are returned; storage keys never leave the API.
async function activeSharedProperty(token: string, select: { id: boolean; publicShareExpiresAt: boolean }) {
  if (!isValidShareToken(token)) throw createError('Shared property not found', 404)
  const property = await prisma.property.findFirst({
    where: { publicShareToken: token, publicShareEnabled: true, isActive: true, deletedAt: null },
    select
  })
  if (!property || isShareExpired(property.publicShareExpiresAt)) throw createError('Shared property not found', 404)
  return property
}

router.get('/properties/:token/attachments', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim()
    const property = await activeSharedProperty(token, { id: true, publicShareExpiresAt: true })
    const attachments = await prisma.propertyDocument.findMany({
      where: {
        propertyId: property.id,
        deletedAt: null,
        kind: { in: ['FLOORPLAN', 'BROCHURE'] }
      },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 500
    })
    res.json({
      success: true,
      data: attachments.map((attachment) => serializeAttachment(
        attachment,
        attachment.storageKey
          ? `/api/public/properties/${encodeURIComponent(token)}/attachments/${encodeURIComponent(attachment.id)}/content`
          : null
      ))
    })
  } catch (error) {
    next(error)
  }
})

router.get('/properties/:token/attachments/:attachmentId/content', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim()
    const property = await activeSharedProperty(token, { id: true, publicShareExpiresAt: true })
    const attachment = await prisma.propertyDocument.findFirst({
      where: {
        id: String(req.params.attachmentId || ''),
        propertyId: property.id,
        deletedAt: null,
        kind: { in: ['FLOORPLAN', 'BROCHURE'] }
      },
      select: { storageKey: true, mimeType: true, originalName: true, name: true }
    })
    if (!attachment?.storageKey) throw createError('Attachment not found', 404)
    const buffer = await readDocument(attachment.storageKey)
    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream')
    res.setHeader('Content-Length', String(buffer.length))
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeOriginalName(attachment.originalName || attachment.name)}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(buffer)
  } catch (error) {
    next(error)
  }
})

/**
 * Package 31: read-only client portal for a lead or a deal. The token is the
 * capability, so only an explicitly enabled, active record in an active tenant
 * resolves. Every field below is allow-listed: internal notes, commissions,
 * agent assignments, organization ids, other clients and portal tokens are
 * never queried or returned here.
 */
type PortalMoney = string | number | { toString(): string }
type PortalPropertyRow = {
  referenceNumber: string | null
  title: string
  description: string | null
  type: string
  status: string
  classification: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  postalCode: string | null
  price: PortalMoney | null
  currency: string
  bedrooms: number
  bathrooms: number
  floors: number | null
  area: PortalMoney | null
  areaUnit: string
  yearBuilt: number | null
  condition: string
  negotiable: boolean
  availableFrom: Date | null
}
type PortalPaymentRow = {
  amount: PortalMoney
  currency: string
  status: string
  reference: string | null
  dueAt: Date | null
  paidAt: Date | null
}

function publicPortalProperty(property: PortalPropertyRow) {
  return {
    referenceNumber: property.referenceNumber,
    title: property.title,
    description: property.description,
    type: property.type,
    status: property.status,
    classification: property.classification,
    address: property.address,
    city: property.city,
    state: property.state,
    country: property.country,
    postalCode: property.postalCode,
    price: property.price,
    currency: property.currency,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    floors: property.floors,
    area: property.area,
    areaUnit: property.areaUnit,
    yearBuilt: property.yearBuilt,
    condition: property.condition,
    negotiable: property.negotiable,
    availableFrom: property.availableFrom
  }
}

function publicPortalPayments(payments: PortalPaymentRow[]) {
  return payments.map((payment) => ({
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    reference: payment.reference,
    dueAt: payment.dueAt,
    paidAt: payment.paidAt
  }))
}

function paymentSummary(payments: PortalPaymentRow[]) {
  let due = 0
  let paid = 0
  for (const payment of payments) {
    const amount = Number(String(payment.amount))
    if (!Number.isFinite(amount)) continue
    due += amount
    if (payment.status === 'COMPLETED') {
      paid += amount
    }
  }
  return {
    payments: payments.length,
    due: due.toFixed(2),
    paid: paid.toFixed(2),
    outstanding: Math.max(0, due - paid).toFixed(2)
  }
}

router.get('/client-portal/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim()
    if (!isValidShareToken(token)) throw createError('Client portal link not found', 404)
    const kind = clientPortalKind(token)
    if (!kind) throw createError('Client portal link not found', 404)

    if (kind === 'DEAL') {
      const deal = await prisma.deal.findFirst({
        where: {
          portalToken: token,
          portalEnabled: true,
          isActive: true,
          deletedAt: null,
          organization: { isActive: true, deletedAt: null }
        },
        select: {
          referenceNumber: true,
          type: true,
          status: true,
          amount: true,
          currency: true,
          startedAt: true,
          dueAt: true,
          closedAt: true,
          leaseStartAt: true,
          leaseEndAt: true,
          organization: { select: { name: true } },
          property: {
            select: {
              referenceNumber: true,
              title: true,
              description: true,
              type: true,
              status: true,
              classification: true,
              address: true,
              city: true,
              state: true,
              country: true,
              postalCode: true,
              price: true,
              currency: true,
              bedrooms: true,
              bathrooms: true,
              floors: true,
              area: true,
              areaUnit: true,
              yearBuilt: true,
              condition: true,
              negotiable: true,
              availableFrom: true
            }
          },
          // Only the linked client is shown; no other client on the property is queried.
          lead: { select: { firstName: true, lastName: true } },
          payments: {
            where: { deletedAt: null },
            orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
            select: {
              amount: true,
              currency: true,
              status: true,
              reference: true,
              dueAt: true,
              paidAt: true
            }
          }
        }
      })
      if (!deal) throw createError('Client portal link not found', 404)
      const payments = publicPortalPayments(deal.payments)
      const clientName = [deal.lead?.firstName, deal.lead?.lastName].filter(Boolean).join(' ').trim()
      res.json({
        success: true,
        data: {
          kind,
          client: {
            displayName: clientName || (deal.referenceNumber ? `Deal ${deal.referenceNumber}` : 'Client'),
            organizationName: deal.organization.name
          },
          property: publicPortalProperty(deal.property),
          clientInterest: deal.lead ? { displayName: clientName } : null,
          deal: {
            referenceNumber: deal.referenceNumber,
            type: deal.type,
            status: deal.status,
            amount: deal.amount,
            currency: deal.currency,
            startedAt: deal.startedAt,
            dueAt: deal.dueAt,
            closedAt: deal.closedAt,
            leaseStartAt: deal.leaseStartAt,
            leaseEndAt: deal.leaseEndAt,
            payments,
            summary: paymentSummary(deal.payments)
          },
          deals: [],
          lead: null
        }
      })
      return
    }

    const lead = await prisma.lead.findFirst({
      where: {
        portalToken: token,
        portalEnabled: true,
        isActive: true,
        deletedAt: null,
        OR: [
          { property: { isActive: true, deletedAt: null, organization: { isActive: true, deletedAt: null } } },
          { assignedTo: { isActive: true, deletedAt: null, organization: { isActive: true, deletedAt: null } } }
        ]
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        preferredType: true,
        preferredCity: true,
        preferredBedrooms: true,
        budgetMin: true,
        budgetMax: true,
        property: {
          select: {
            organizationId: true,
            referenceNumber: true,
            title: true,
            description: true,
            type: true,
            status: true,
            classification: true,
            address: true,
            city: true,
            state: true,
            country: true,
            postalCode: true,
            price: true,
            currency: true,
            bedrooms: true,
            bathrooms: true,
            floors: true,
            area: true,
            areaUnit: true,
            yearBuilt: true,
            condition: true,
            negotiable: true,
            availableFrom: true
          }
        },
        assignedTo: {
          select: {
            organizationId: true,
            organization: { select: { name: true, isActive: true, deletedAt: true } }
          }
        }
      }
    })
    if (!lead) throw createError('Client portal link not found', 404)

    // Leads have no direct tenant id: both non-null relations must agree, just
    // like leadScope() on management routes.
    const propertyTenant = lead.property?.organizationId || null
    const assignedTenant = lead.assignedTo?.organizationId || null
    const organizationId = propertyTenant || assignedTenant
    if (!organizationId || (propertyTenant && propertyTenant !== organizationId) || (assignedTenant && assignedTenant !== organizationId)) {
      throw createError('Client portal link not found', 404)
    }
    if (lead.assignedTo && (!lead.assignedTo.organization.isActive || lead.assignedTo.organization.deletedAt)) {
      throw createError('Client portal link not found', 404)
    }
    const organization = await prisma.organization.findFirst({
      where: { id: organizationId, isActive: true, deletedAt: null },
      select: { name: true }
    })
    if (!organization) throw createError('Client portal link not found', 404)

    const deals = await prisma.deal.findMany({
      where: { leadId: lead.id, organizationId, isActive: true, deletedAt: null },
      select: {
        referenceNumber: true,
        type: true,
        status: true,
        amount: true,
        currency: true,
        dueAt: true,
        leaseEndAt: true,
        property: { select: { title: true, referenceNumber: true, city: true } },
        payments: {
          where: { deletedAt: null },
          orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
          select: {
            amount: true,
            currency: true,
            status: true,
            reference: true,
            dueAt: true,
            paidAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    })

    const displayName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim()
    res.json({
      success: true,
      data: {
        kind,
        client: { displayName: displayName || 'Client', organizationName: organization.name },
        property: lead.property ? publicPortalProperty(lead.property) : null,
        clientInterest: null,
        deal: null,
        deals: deals.map((deal) => ({
          referenceNumber: deal.referenceNumber,
          type: deal.type,
          status: deal.status,
          amount: deal.amount,
          currency: deal.currency,
          dueAt: deal.dueAt,
          leaseEndAt: deal.leaseEndAt,
          property: deal.property,
          payments: publicPortalPayments(deal.payments),
          summary: paymentSummary(deal.payments)
        })),
        lead: {
          status: lead.status,
          preferredType: lead.preferredType,
          preferredCity: lead.preferredCity,
          preferredBedrooms: lead.preferredBedrooms,
          budgetMin: lead.budgetMin,
          budgetMax: lead.budgetMax
        }
      }
    })
  } catch (error) {
    next(error)
  }
})

/**
 * Package 28: read-only owner portal. The token itself is the capability, so
 * only an explicitly enabled, active owner in an active tenant is resolved,
 * and the response is allow-listed field by field. Owner notes, internal
 * property notes, agent/branch assignments, documents, payouts and financial
 * amounts are never queried here.
 */
router.get('/owner-portal/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim()
    if (!isValidShareToken(token)) throw createError('Owner portal link not found', 404)
    const owner = await prisma.owner.findFirst({
      where: {
        portalToken: token,
        portalEnabled: true,
        isActive: true,
        deletedAt: null,
        organizationId: { not: null },
        organization: { isActive: true, deletedAt: null }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyName: true,
        city: true,
        country: true,
        organizationId: true,
        organization: { select: { name: true } }
      }
    })
    if (!owner?.organizationId) throw createError('Owner portal link not found', 404)

    const properties = await prisma.property.findMany({
      where: {
        ownerId: owner.id,
        organizationId: owner.organizationId,
        isActive: true,
        deletedAt: null
        // Deliberately omit publicShareEnabled: the portal link grants its own
        // read-only access to the owner's portfolio.
      },
      select: {
        id: true,
        referenceNumber: true,
        title: true,
        description: true,
        type: true,
        status: true,
        classification: true,
        address: true,
        city: true,
        state: true,
        country: true,
        postalCode: true,
        price: true,
        currency: true,
        bedrooms: true,
        bathrooms: true,
        floors: true,
        area: true,
        areaUnit: true,
        yearBuilt: true,
        condition: true,
        negotiable: true,
        availableFrom: true
      },
      orderBy: { updatedAt: 'desc' },
      take: 500
    })
    const propertyIds = properties.map((property) => property.id)
    const deals = propertyIds.length
      ? await prisma.deal.findMany({
          where: {
            organizationId: owner.organizationId,
            propertyId: { in: propertyIds },
            deletedAt: null
          },
          select: { status: true },
          take: 5000
        })
      : []
    const dealStatuses: Record<string, number> = {}
    for (const deal of deals) dealStatuses[deal.status] = (dealStatuses[deal.status] || 0) + 1

    const displayName = [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim()
    res.json({
      success: true,
      data: {
        owner: {
          displayName: owner.companyName || displayName || '',
          city: owner.city,
          country: owner.country,
          organizationName: owner.organization?.name || null
        },
        properties: properties.map((property) => ({
          referenceNumber: property.referenceNumber,
          title: property.title,
          description: property.description,
          type: property.type,
          status: property.status,
          classification: property.classification,
          address: property.address,
          city: property.city,
          state: property.state,
          country: property.country,
          postalCode: property.postalCode,
          price: property.price,
          currency: property.currency,
          bedrooms: property.bedrooms,
          bathrooms: property.bathrooms,
          floors: property.floors,
          area: property.area,
          areaUnit: property.areaUnit,
          yearBuilt: property.yearBuilt,
          condition: property.condition,
          negotiable: property.negotiable,
          availableFrom: property.availableFrom
        })),
        summary: {
          properties: properties.length,
          deals: deals.length,
          dealStatuses
        }
      }
    })
  } catch (error) {
    next(error)
  }
})

export default router
