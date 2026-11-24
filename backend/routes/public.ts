import { Router } from 'express'
import { prisma } from '../prisma'
import { createError } from '../middleware/errorHandler'
import { isShareExpired, isValidShareToken } from '../utils/share'
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

export default router
