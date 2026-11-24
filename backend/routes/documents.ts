import { Router, type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import { DocumentStatus, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { leadScope, ownerReadScope, organizationIdOf, userIdOf } from '../utils/scope'
import { optionalString, pagination, requiredString } from '../utils/validation'
import { createStorageKey, sanitizeOriginalName, validateDocumentFile } from '../utils/files'
import { readDocument, removeDocument, writeDocument } from '../storage/local'
import { logAudit } from '../utils/audit'

const router = Router()
router.use(authMiddleware)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
})

function uploadMiddleware(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (error: unknown) => {
    if (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
      return next(createError(message, code === 'LIMIT_FILE_SIZE' ? 413 : 400))
    }
    next()
  })
}

function accessWhere(organizationId: string, req: Request): Prisma.DocumentWhereInput {
  const where: Prisma.DocumentWhereInput = { organizationId, deletedAt: null }
  if (req.user?.role === 'AGENT') {
    const userId = req.user.id
    where.OR = [
      { uploadedById: userId },
      { property: { assignedAgentId: userId } },
      { deal: { userId } },
      { lead: { assignedToId: userId } }
    ]
  }
  return where
}

interface DocumentLinks {
  propertyId?: string
  ownerId?: string
  leadId?: string
  dealId?: string
  paymentId?: string
  expenseId?: string
}

async function validateLinks(organizationId: string, links: DocumentLinks) {
  if (links.propertyId) {
    const found = await prisma.property.findFirst({ where: { id: links.propertyId, organizationId, deletedAt: null }, select: { id: true } })
    if (!found) throw createError('Linked property not found', 404)
  }
  if (links.ownerId) {
    const found = await prisma.owner.findFirst({
      where: { id: links.ownerId, deletedAt: null, ...ownerReadScope(organizationId) },
      select: { id: true }
    })
    if (!found) throw createError('Linked owner not found', 404)
  }
  if (links.leadId) {
    const found = await prisma.lead.findFirst({
      where: {
        id: links.leadId,
        deletedAt: null,
        ...leadScope(organizationId)
      },
      select: { id: true }
    })
    if (!found) throw createError('Linked lead not found', 404)
  }
  if (links.dealId) {
    const found = await prisma.deal.findFirst({ where: { id: links.dealId, organizationId, deletedAt: null }, select: { id: true } })
    if (!found) throw createError('Linked deal not found', 404)
  }
  if (links.paymentId) {
    const found = await prisma.payment.findFirst({ where: { id: links.paymentId, deal: { organizationId }, deletedAt: null }, select: { id: true } })
    if (!found) throw createError('Linked payment not found', 404)
  }
  if (links.expenseId) {
    const found = await prisma.expense.findFirst({
      where: {
        id: links.expenseId,
        deletedAt: null,
        OR: [{ property: { organizationId } }, { deal: { organizationId } }, { responsible: { organizationId } }]
      },
      select: { id: true }
    })
    if (!found) throw createError('Linked expense not found', 404)
  }
}

async function assertAgentLinkAccess(organizationId: string, req: Request, links: DocumentLinks) {
  if (req.user?.role !== 'AGENT') return
  const userId = req.user.id
  const deny = () => createError('Insufficient permissions to link this document', 403)

  if (links.propertyId) {
    const found = await prisma.property.findFirst({
      where: { id: links.propertyId, organizationId, deletedAt: null, assignedAgentId: userId },
      select: { id: true }
    })
    if (!found) throw deny()
  }
  if (links.dealId) {
    const found = await prisma.deal.findFirst({
      where: { id: links.dealId, organizationId, deletedAt: null, userId },
      select: { id: true }
    })
    if (!found) throw deny()
  }
  if (links.leadId) {
    const found = await prisma.lead.findFirst({
      where: { id: links.leadId, deletedAt: null, assignedToId: userId },
      select: { id: true }
    })
    if (!found) throw deny()
  }
  if (links.ownerId) {
    const found = await prisma.owner.findFirst({
      where: {
        id: links.ownerId,
        deletedAt: null,
        properties: { some: { organizationId, assignedAgentId: userId } }
      },
      select: { id: true }
    })
    if (!found) throw deny()
  }
  if (links.paymentId) {
    const found = await prisma.payment.findFirst({
      where: { id: links.paymentId, deletedAt: null, deal: { organizationId, userId } },
      select: { id: true }
    })
    if (!found) throw deny()
  }
  if (links.expenseId) {
    const found = await prisma.expense.findFirst({
      where: {
        id: links.expenseId,
        deletedAt: null,
        OR: [
          { property: { organizationId, assignedAgentId: userId } },
          { deal: { organizationId, userId } },
          { responsibleId: userId }
        ]
      },
      select: { id: true }
    })
    if (!found) throw deny()
  }
}

router.get('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const conditions: Prisma.DocumentWhereInput[] = [accessWhere(organizationId, req)]
    if (req.query.search) {
      const search = String(req.query.search)
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { originalName: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } }
        ]
      })
    }
    const where: Prisma.DocumentWhereInput = { AND: conditions }
    if (req.query.category) where.category = String(req.query.category)
    const statusFilter = req.query.status === undefined ? DocumentStatus.ACTIVE : String(req.query.status).toUpperCase()
    if (statusFilter !== 'ALL' && statusFilter !== '') where.status = enumDocumentStatus(statusFilter)
    if (req.query.propertyId) where.propertyId = String(req.query.propertyId)
    if (req.query.dealId) where.dealId = String(req.query.dealId)
    if (req.query.from || req.query.to) {
      where.createdAt = {
        ...(req.query.from ? { gte: new Date(String(req.query.from)) } : {}),
        ...(req.query.to ? { lte: new Date(String(req.query.to)) } : {})
      }
    }

    const [total, documents] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          uploadedBy: { select: { id: true, email: true, firstName: true } },
          property: { select: { id: true, title: true } },
          deal: { select: { id: true, referenceNumber: true } }
        }
      })
    ])
    res.json({ success: true, data: documents, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error) {
    next(error)
  }
})

function enumDocumentStatus(value: unknown): DocumentStatus {
  const status = String(value).toUpperCase()
  if (status !== 'ACTIVE' && status !== 'ARCHIVED') throw createError('Invalid document status', 400)
  return status
}

router.post('/', uploadMiddleware, async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const file = req.file
    if (!file) throw createError('A document file is required', 400)
    validateDocumentFile(file)

    const links = {
      propertyId: optionalString(req.body?.propertyId, 'propertyId', 100),
      ownerId: optionalString(req.body?.ownerId, 'ownerId', 100),
      leadId: optionalString(req.body?.leadId, 'leadId', 100),
      dealId: optionalString(req.body?.dealId, 'dealId', 100),
      paymentId: optionalString(req.body?.paymentId, 'paymentId', 100),
      expenseId: optionalString(req.body?.expenseId, 'expenseId', 100)
    }
    await validateLinks(organizationId, links)
    await assertAgentLinkAccess(organizationId, req, links)

    const storageKey = createStorageKey(file.originalname)
    await writeDocument(storageKey, file.buffer)
    try {
      const document = await prisma.document.create({
        data: {
          organizationId,
          name: optionalString(req.body?.name, 'name', 200) || sanitizeOriginalName(file.originalname),
          originalName: sanitizeOriginalName(file.originalname),
          storageKey,
          mimeType: file.mimetype.toLowerCase(),
          size: file.size,
          category: (optionalString(req.body?.category, 'category', 80) || 'OTHER').toUpperCase(),
          description: optionalString(req.body?.description, 'description', 5000),
          notes: optionalString(req.body?.notes, 'notes', 5000),
          uploadedById: userId,
          ...links
        }
      })
      await logAudit(prisma, { userId, action: 'DOCUMENT_UPLOADED', entityType: 'Document', entityId: document.id, details: { category: document.category, size: document.size } })
      res.status(201).json({ success: true, data: document, message: 'Document uploaded successfully' })
    } catch (error) {
      await removeDocument(storageKey)
      throw error
    }
  } catch (error) {
    next(error)
  }
})

async function sendDocument(req: Request, res: Response, disposition: 'attachment' | 'inline'): Promise<void> {
  const organizationId = organizationIdOf(req)
  const where = accessWhere(organizationId, req)
  where.id = String(req.params.id)
  const document = await prisma.document.findFirst({ where })
  if (!document) throw createError('Document not found', 404)
  const buffer = await readDocument(document.storageKey)
  res.setHeader('Content-Type', document.mimeType)
  res.setHeader('Content-Length', String(buffer.length))
  res.setHeader('Content-Disposition', `${disposition}; filename="${sanitizeOriginalName(document.originalName)}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(buffer)
}

router.get('/:id/download', async (req, res, next) => {
  try {
    await sendDocument(req, res, 'attachment')
  } catch (error) {
    next(error)
  }
})

// Authenticated inline delivery for previewing PDFs/images in a new tab.
router.get('/:id/preview', async (req, res, next) => {
  try {
    await sendDocument(req, res, 'inline')
  } catch (error) {
    next(error)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const where = accessWhere(organizationId, req)
    where.id = id
    const existing = await prisma.document.findFirst({ where })
    if (!existing) throw createError('Document not found', 404)

    const data: Prisma.DocumentUpdateInput = {}
    if (req.body?.name !== undefined) data.name = requiredString(req.body.name, 'name', 200)
    if (req.body?.description !== undefined) data.description = optionalString(req.body.description, 'description', 5000)
    if (req.body?.notes !== undefined) data.notes = optionalString(req.body.notes, 'notes', 5000)
    if (req.body?.category !== undefined) data.category = (optionalString(req.body.category, 'category', 80) || 'OTHER').toUpperCase()
    if (req.body?.status !== undefined) data.status = enumDocumentStatus(req.body.status)
    const document = await prisma.$transaction(async (tx) => {
      const updated = await tx.document.update({ where: { id }, data })
      await logAudit(tx, { userId, action: req.body?.status ? 'DOCUMENT_STATUS_CHANGED' : 'DOCUMENT_UPDATED', entityType: 'Document', entityId: id, details: { status: updated.status } })
      return updated
    })
    res.json({ success: true, data: document, message: 'Document updated successfully' })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const where = accessWhere(organizationId, req)
    where.id = id
    const existing = await prisma.document.findFirst({ where })
    if (!existing) throw createError('Document not found', 404)

    const document = await prisma.$transaction(async (tx) => {
      const updated = await tx.document.update({
        where: { id },
        data: { status: DocumentStatus.ARCHIVED }
      })
      await logAudit(tx, {
        userId,
        action: 'DOCUMENT_ARCHIVED',
        entityType: 'Document',
        entityId: id,
        details: { storageKey: existing.storageKey }
      })
      return updated
    })
    res.json({ success: true, data: document, message: 'Document archived successfully' })
  } catch (error) {
    next(error)
  }
})

export default router
