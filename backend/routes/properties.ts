import { Router, type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import {
  AreaUnit,
  OccupancyStatus,
  Prisma,
  PropertyAttachmentKind,
  PropertyClassification,
  PropertyCondition,
  PropertyStatus,
  PropertyType
} from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { FINANCE_ROLES, MANAGEMENT_ROLES, organizationIdOf, ownerReadScope, roleOf, userIdOf } from '../utils/scope'
import {
  booleanValue,
  dateValue,
  enumValue,
  numberValue,
  optionalString,
  pagination,
  requiredString
} from '../utils/validation'
import crypto from 'node:crypto'
import { buildPublicShareUrl } from '../utils/share'
import { parseMoney } from '../utils/money'
import { buildPropertySearch } from '../utils/search'
import { validatePropertyTransition } from '../utils/propertyStatus'
import { logAudit, logPropertyActivity } from '../utils/audit'
import { priceChangeMetadata, PROPERTY_PRICE_CHANGED } from '../utils/priceHistory'
import { buildDuplicateDraft } from '../utils/propertyDuplication'
import { notifyUsers, organizationRecipientIds } from '../services/notifications'
import { createStorageKey, sanitizeOriginalName, validateDocumentFile, validateImageFile } from '../utils/files'
import { readDocument, readPropertyImage, removeDocument, removePropertyImage, writeDocument, writePropertyImage } from '../storage/local'
import { parseAttachmentKind, serializeAttachment, validateAttachmentUrl } from '../utils/propertyAttachments'
import { buildImportPreview, importHeaders, type ImportPreview } from '../utils/csvImport'
import { PROPERTY_IMPORT_FIELDS, propertyImportData } from '../utils/propertyImport'
import { BOARD_STATUSES, boardQuickTransitions, groupByBoardStatus } from '../utils/propertyBoard'

const router = Router()
router.use(authMiddleware)

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 }
})

function imageUploadMiddleware(req: Request, res: Response, next: NextFunction) {
  imageUpload.array('files', 10)(req, res, (error: unknown) => {
    if (error) {
      const message = error instanceof Error ? error.message : 'Image upload failed'
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
      return next(createError(message, code === 'LIMIT_FILE_SIZE' ? 413 : 400))
    }
    next()
  })
}

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
})

function attachmentUploadMiddleware(req: Request, res: Response, next: NextFunction) {
  attachmentUpload.single('file')(req, res, (error: unknown) => {
    if (error) {
      const message = error instanceof Error ? error.message : 'Attachment upload failed'
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
      return next(createError(message, code === 'LIMIT_FILE_SIZE' ? 413 : 400))
    }
    next()
  })
}

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }
})

function importUploadMiddleware(req: Request, res: Response, next: NextFunction) {
  importUpload.single('file')(req, res, (error: unknown) => {
    if (error) {
      const message = error instanceof Error ? error.message : 'CSV upload failed'
      return next(createError(message, 400))
    }
    next()
  })
}

async function assertRelatedUsers(assignedAgentId: string | undefined, ownerId: string | undefined, organizationId: string) {
  if (assignedAgentId) {
    const user = await prisma.user.findFirst({
      where: { id: assignedAgentId, organizationId, deletedAt: null },
      select: { id: true }
    })
    if (!user) throw createError('Assigned agent not found', 404)
  }
  if (ownerId) {
    const owner = await prisma.owner.findFirst({
      where: { id: ownerId, deletedAt: null, isActive: true, ...ownerReadScope(organizationId) },
      select: { id: true }
    })
    if (!owner) throw createError('Owner not found', 404)
  }
}

type ImportIssue = { field: string; message: string }

function isDryRun(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  return value !== false && String(value).toLowerCase() !== 'false'
}

/** Copies the pure preview and appends database-level checks per row. */
async function validatePropertyImportRows(preview: ImportPreview, organizationId: string): Promise<ImportPreview> {
  const seenReferences = new Set<string>()
  const rows = await Promise.all(preview.rows.map(async (result) => {
    if (result.errors.length > 0) return result
    const issues: ImportIssue[] = []
    const values = result.values
    const referenceNumber = typeof values.referenceNumber === 'string' ? values.referenceNumber.trim() : ''
    if (referenceNumber) {
      if (seenReferences.has(referenceNumber)) {
        issues.push({ field: 'referenceNumber', message: 'Duplicate reference number in CSV' })
      } else {
        seenReferences.add(referenceNumber)
        const existing = await prisma.property.findFirst({
          where: { referenceNumber },
          select: { id: true }
        })
        if (existing) issues.push({ field: 'referenceNumber', message: 'Reference number already exists' })
      }
    }
    const currency = typeof values.currency === 'string' ? values.currency.trim() : ''
    if (currency && !/^[A-Za-z]{3}$/.test(currency)) {
      issues.push({ field: 'currency', message: 'currency must be a 3-letter ISO code' })
    }
    const assignedAgentId = typeof values.assignedAgentId === 'string' ? values.assignedAgentId.trim() : undefined
    const ownerId = typeof values.ownerId === 'string' ? values.ownerId.trim() : undefined
    if (assignedAgentId || ownerId) {
      try {
        await assertRelatedUsers(assignedAgentId, ownerId, organizationId)
      } catch (error) {
        issues.push({
          field: assignedAgentId ? 'assignedAgentId' : 'ownerId',
          message: error instanceof Error ? error.message : 'Related record not found'
        })
      }
    }
    return { ...result, errors: [...result.errors, ...issues] }
  }))
  const invalidCount = rows.filter((row) => row.errors.length > 0).length
  return { ...preview, rows, validCount: rows.length - invalidCount, invalidCount }
}

async function listProperties(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const organizationId = organizationIdOf(req)
    const { page, limit, skip } = pagination(req.query as Record<string, unknown>)
    const filters = req.query as Record<string, unknown>
    const { where, orderBy } = buildPropertySearch(filters as never, organizationId)
    if (req.user?.role === 'AGENT') where.assignedAgentId = userIdOf(req)

    const [total, properties] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          owner: true,
          assignedAgent: { select: { id: true, email: true, firstName: true } },
          _count: { select: { leads: true, deals: true, maintenanceRequests: true } }
        }
      })
    ])
    res.json({
      success: true,
      data: properties,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    next(error)
  }
}

router.get('/', listProperties)
router.get('/search', listProperties)

router.post('/bulk', requireRole(MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id: unknown) => String(id)).filter(Boolean) : []
    if (!ids.length) throw createError('At least one property id is required', 400)
    if (ids.length > 100) throw createError('A maximum of 100 properties can be processed at once', 400)

    const action = requiredString(req.body?.action, 'action', 50).toLowerCase()
    const allowedActions = ['archive', 'restore', 'status', 'assign']
    if (!allowedActions.includes(action)) throw createError('Unsupported bulk action', 400)

    const status = action === 'status'
      ? enumValue(req.body?.status, 'status', Object.values(PropertyStatus))
      : undefined
    const assignedAgentId = action === 'assign'
      ? optionalString(req.body?.assignedAgentId, 'assignedAgentId', 100)
      : undefined
    if (action === 'assign' && req.body?.assignedAgentId !== undefined && req.body?.assignedAgentId !== null && req.body?.assignedAgentId !== '' && !assignedAgentId) {
      throw createError('Invalid assignedAgentId', 400)
    }
    if (action === 'assign' && assignedAgentId) {
      await assertRelatedUsers(assignedAgentId, undefined, organizationId)
    }

    const properties = await prisma.property.findMany({
      where: { id: { in: ids }, organizationId },
      take: 500,
      select: { id: true, title: true, status: true, assignedAgentId: true, isActive: true, deletedAt: true }
    })
    const foundIds = new Set(properties.map((property) => property.id))
    type BulkResult = { id: string; success: boolean; message: string }
    const results: BulkResult[] = ids.map((id: string) => {
      if (!foundIds.has(id)) {
        return { id, success: false, message: 'Property not found or inaccessible' }
      }
      return { id, success: false, message: 'Not processed' }
    })
    const resultById = new Map<string, BulkResult>(results.map((result: BulkResult) => [result.id, result]))

    await prisma.$transaction(async (tx) => {
      for (const property of properties) {
        const result = resultById.get(property.id)!
        try {
          if (action === 'archive') {
            if (!property.isActive || property.deletedAt) {
              result.success = true
              result.message = 'Already archived'
              continue
            }
            await tx.property.update({ where: { id: property.id }, data: { isActive: false, deletedAt: new Date() } })
            await logPropertyActivity(tx, { propertyId: property.id, userId, action: 'PROPERTY_ARCHIVED' })
            await logAudit(tx, { userId, action: 'PROPERTY_BULK_ARCHIVED', entityType: 'Property', entityId: property.id })
            result.success = true
            result.message = 'Archived'
            continue
          }

          if (action === 'restore') {
            if (property.isActive && !property.deletedAt) {
              result.success = true
              result.message = 'Already active'
              continue
            }
            await tx.property.update({ where: { id: property.id }, data: { isActive: true, deletedAt: null } })
            await logPropertyActivity(tx, { propertyId: property.id, userId, action: 'PROPERTY_RESTORED' })
            await logAudit(tx, { userId, action: 'PROPERTY_BULK_RESTORED', entityType: 'Property', entityId: property.id })
            result.success = true
            result.message = 'Restored'
            continue
          }

          if (property.deletedAt || !property.isActive) {
            result.message = 'Archived properties must be restored before this action'
            continue
          }

          if (action === 'status' && status) {
            validatePropertyTransition(property.status, status)
            const updated = await tx.property.update({
              where: { id: property.id },
              data: {
                status,
                reservedUntil: status === PropertyStatus.RESERVED
                  ? dateValue(req.body?.reservedUntil, 'reservedUntil') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                  : property.status === PropertyStatus.RESERVED ? null : undefined
              }
            })
            await logPropertyActivity(tx, { propertyId: property.id, userId, action: 'PROPERTY_STATUS_CHANGED', details: { before: property.status, after: status, bulk: true } })
            await logAudit(tx, { userId, action: 'PROPERTY_BULK_STATUS_CHANGED', entityType: 'Property', entityId: property.id, details: { before: property.status, after: status } })
            const recipients = await organizationRecipientIds(tx, organizationId, {
              roles: ['ADMIN', 'MANAGER'],
              includeUserIds: [property.assignedAgentId || ''],
              excludeUserId: userId
            })
            await notifyUsers(tx, recipients, {
              organizationId,
              type: 'PROPERTY_STATUS_CHANGED',
              title: 'Property status updated',
              message: `${property.title} changed from ${property.status} to ${status}.`,
              entityType: 'Property',
              entityId: property.id,
              actionUrl: `/properties/${property.id}`,
              metadata: { before: property.status, after: status, bulk: true }
            })
            result.success = true
            result.message = `Status set to ${updated.status}`
            continue
          }

          if (action === 'assign') {
            await tx.property.update({
              where: { id: property.id },
              data: assignedAgentId ? { assignedAgent: { connect: { id: assignedAgentId } } } : { assignedAgent: { disconnect: true } }
            })
            await logPropertyActivity(tx, { propertyId: property.id, userId, action: 'PROPERTY_ASSIGNED', details: { before: property.assignedAgentId, after: assignedAgentId || null, bulk: true } })
            await logAudit(tx, { userId, action: 'PROPERTY_BULK_ASSIGNED', entityType: 'Property', entityId: property.id, details: { before: property.assignedAgentId, after: assignedAgentId || null } })
            if (assignedAgentId && assignedAgentId !== userId) {
              await notifyUsers(tx, [assignedAgentId], {
                organizationId,
                type: 'PROPERTY_ASSIGNED',
                title: 'Property assigned to you',
                message: `${property.title} was assigned to you.`,
                entityType: 'Property',
                entityId: property.id,
                actionUrl: `/properties/${property.id}`,
                metadata: { bulk: true }
              })
            }
            result.success = true
            result.message = assignedAgentId ? 'Assigned' : 'Unassigned'
            continue
          }
        } catch (error) {
          result.message = error instanceof Error ? error.message : 'Operation failed'
        }
      }
    })

    const succeeded = results.filter((result) => result.success).length
    res.json({
      success: true,
      data: { action, total: ids.length, succeeded, failed: ids.length - succeeded, results },
      message: `Bulk ${action} completed: ${succeeded}/${ids.length} succeeded`
    })
  } catch (error) {
    next(error)
  }
})

async function findAccessibleProperty(id: string, req: Request, options: { forWrite?: boolean } = {}) {
  const organizationId = organizationIdOf(req)
  const property = await prisma.property.findFirst({ where: { id, organizationId, deletedAt: null } })
  if (!property) throw createError('Property not found', 404)
  if (req.user?.role === 'AGENT' && property.assignedAgentId !== userIdOf(req)) {
    throw createError(options.forWrite ? 'Insufficient permissions to update this property' : 'Insufficient permissions to view this property', 403)
  }
  return property
}

/**
 * CSV import: multipart `file` or JSON `csv`. Dry runs (the default) return a
 * per-row validation preview; a real import creates every property in one
 * transaction. Template: importTemplate(PROPERTY_IMPORT_FIELDS).
 */
router.post('/import', requireRole(MANAGEMENT_ROLES), importUploadMiddleware, async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const body = req.body as Record<string, unknown>
    const csv = typeof body?.csv === 'string'
      ? body.csv
      : req.file?.buffer.toString('utf8') ?? ''
    if (!csv.trim()) throw createError('CSV content is required', 400)

    const preview = buildImportPreview(csv, PROPERTY_IMPORT_FIELDS)
    if (preview.rows.length > 500) throw createError('A maximum of 500 rows can be imported at once', 400)
    const checked = await validatePropertyImportRows(preview, organizationId)

    if (isDryRun(body?.dryRun)) {
      return res.json({
        success: true,
        data: {
          dryRun: true,
          preview: checked,
          headers: importHeaders(PROPERTY_IMPORT_FIELDS)
        },
        message: 'Import preview generated'
      })
    }
    if (checked.invalidCount > 0) {
      throw createError('All rows must be valid before importing', 400)
    }

    const stamp = Date.now().toString(36).toUpperCase()
    const ids: string[] = []
    await prisma.$transaction(async (tx) => {
      for (const [index, result] of checked.rows.entries()) {
        const values = { ...result.values }
        if (!values.referenceNumber) {
          values.referenceNumber = `PROP-${stamp}-${index + 1}`
        }
        const assignedAgentId = typeof values.assignedAgentId === 'string' && values.assignedAgentId
          ? values.assignedAgentId.trim()
          : undefined
        const ownerId = typeof values.ownerId === 'string' && values.ownerId
          ? values.ownerId.trim()
          : undefined
        delete values.assignedAgentId
        delete values.ownerId
        const created = await tx.property.create({
          data: {
            ...propertyImportData(values),
            organization: { connect: { id: organizationId } },
            ...(assignedAgentId ? { assignedAgent: { connect: { id: assignedAgentId } } } : {}),
            ...(ownerId ? { owner: { connect: { id: ownerId } } } : {})
          }
        })
        await logPropertyActivity(tx, { propertyId: created.id, userId, action: 'PROPERTY_CREATED', details: { imported: true } })
        await logAudit(tx, {
          userId,
          action: 'PROPERTY_IMPORTED',
          entityType: 'Property',
          entityId: created.id,
          details: { sourceRow: result.row, referenceNumber: created.referenceNumber }
        })
        ids.push(created.id)
      }
    })
    res.json({
      success: true,
      data: { total: checked.rows.length, created: ids.length, ids },
      message: `${ids.length} properties imported successfully`
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A property with this reference number already exists', 409))
    }
    next(error)
  }
})

/** Read-only status board; registered before /:id so 'board' is not an id. */
router.get('/board', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const where: Prisma.PropertyWhereInput = {
      organizationId,
      deletedAt: null,
      status: { in: [...BOARD_STATUSES] }
    }
    if (req.user?.role === 'AGENT') where.assignedAgentId = userIdOf(req)
    const properties = await prisma.property.findMany({
      where,
      take: 500,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        referenceNumber: true,
        status: true,
        price: true,
        currency: true,
        assignedAgentId: true
      }
    })
    const grouped = groupByBoardStatus(properties)
    res.json({
      success: true,
      data: {
        columns: BOARD_STATUSES.map((status) => ({ status, label: status, count: grouped[status].length })),
        properties: grouped,
        transitions: Object.fromEntries(BOARD_STATUSES.map((status) => [status, boardQuickTransitions(status)]))
      }
    })
  } catch (error) {
    next(error)
  }
})

/**
 * Sanitized prefill for "Duplicate Property". The client opens /properties/new
 * with this draft; no identifier, share token, audit array or financial
 * relation is included in the response.
 */
router.get('/:id/duplicate-draft', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const property = await findAccessibleProperty(id, req)
    const draft = buildDuplicateDraft(property as unknown as Record<string, unknown>)
    res.json({ success: true, data: draft })
  } catch (error) {
    next(error)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const id = String(req.params.id)
    const role = roleOf(req)
    const canSeeFinance = Boolean(role && FINANCE_ROLES.includes(role))
    const property = await prisma.property.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        owner: true,
        assignedAgent: { select: { id: true, email: true, firstName: true, role: true } },
        images: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        // Package 14: floorplan/brochure rows live in the existing documents
        // relation; the API aliases them as `attachments` for clients.
        documents: {
          where: { deletedAt: null, kind: { in: [PropertyAttachmentKind.FLOORPLAN, PropertyAttachmentKind.BROCHURE] } },
          orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }]
        },
        linkedDocuments: { where: { status: 'ACTIVE', deletedAt: null }, orderBy: { createdAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 100 },
        leads: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        appointments: { orderBy: { startsAt: 'asc' }, take: 50 },
        deals: canSeeFinance ? { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } } : false,
        expenses: canSeeFinance ? { where: { deletedAt: null }, orderBy: { spentAt: 'desc' } } : false,
        maintenanceRequests: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } }
      }
    })
    if (!property) throw createError('Property not found', 404)
    if (req.user?.role === 'AGENT' && property.assignedAgentId !== userIdOf(req)) {
      throw createError('Insufficient permissions to view this property', 403)
    }
    // Finance-only relations are omitted entirely for non-finance viewers;
    // returning empty arrays would still leak the shape of hidden data.
    const data = canSeeFinance ? property : { ...property, deals: undefined, expenses: undefined }
    res.json({
      success: true,
      data: {
        ...data,
        attachments: property.documents.map((attachment) => serializeAttachment(
          attachment,
          attachment.storageKey ? `/api/properties/${id}/attachments/${attachment.id}/content` : null
        ))
      }
    })
  } catch (error) {
    next(error)
  }
})

// The shareable summary itself is built on the client from public listing fields.
// This endpoint only records that a client-ready summary was generated/copied.
router.post('/:id/share-summary', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    await findAccessibleProperty(id, req)
    const actorId = userIdOf(req)
    await prisma.$transaction(async (tx) => {
      await logPropertyActivity(tx, {
        propertyId: id,
        userId: actorId,
        action: 'PROPERTY_SHARE_SUMMARY_GENERATED'
      })
      await logAudit(tx, {
        userId: actorId,
        action: 'PROPERTY_SHARE_SUMMARY_GENERATED',
        entityType: 'Property',
        entityId: id
      })
    })
    res.json({ success: true, message: 'Property share summary recorded' })
  } catch (error) {
    next(error)
  }
})

function shareUrl(token: string, req: Request): string {
  return buildPublicShareUrl(token, {
    publicAppUrl: process.env.PUBLIC_APP_URL,
    origin: req.get('origin')
  })
}

router.get('/:id/share-link', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const property = await findAccessibleProperty(id, req)
    const enabled = Boolean(property.publicShareEnabled && property.publicShareToken)
    const expired = Boolean(property.publicShareExpiresAt && property.publicShareExpiresAt.getTime() < Date.now())
    res.json({
      success: true,
      data: {
        enabled: enabled && !expired,
        token: enabled && !expired ? property.publicShareToken : null,
        url: enabled && !expired && property.publicShareToken ? shareUrl(property.publicShareToken, req) : null,
        expiresAt: property.publicShareExpiresAt,
        createdAt: property.publicShareCreatedAt
      }
    })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/share-link', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const userId = userIdOf(req)
    await findAccessibleProperty(id, req, { forWrite: true })
    const expiresAt = dateValue(req.body?.expiresAt, 'expiresAt')
    const token = crypto.randomBytes(24).toString('base64url')
    const property = await prisma.$transaction(async (tx) => {
      const updated = await tx.property.update({
        where: { id },
        data: {
          publicShareToken: token,
          publicShareEnabled: true,
          publicShareExpiresAt: expiresAt || null,
          publicShareCreatedAt: new Date()
        }
      })
      await logAudit(tx, { userId, action: 'PROPERTY_SHARE_LINK_CREATED', entityType: 'Property', entityId: id, details: { expiresAt: expiresAt?.toISOString() || null } })
      await logPropertyActivity(tx, { propertyId: id, userId, action: 'PROPERTY_SHARE_LINK_CREATED' })
      return updated
    })
    res.status(201).json({
      success: true,
      data: {
        enabled: true,
        token: property.publicShareToken,
        url: shareUrl(token, req),
        expiresAt: property.publicShareExpiresAt,
        createdAt: property.publicShareCreatedAt
      },
      message: 'Public share link created'
    })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id/share-link', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const userId = userIdOf(req)
    await findAccessibleProperty(id, req, { forWrite: true })
    await prisma.$transaction(async (tx) => {
      await tx.property.update({
        where: { id },
        data: { publicShareEnabled: false, publicShareToken: null, publicShareExpiresAt: null }
      })
      await logAudit(tx, { userId, action: 'PROPERTY_SHARE_LINK_REVOKED', entityType: 'Property', entityId: id })
      await logPropertyActivity(tx, { propertyId: id, userId, action: 'PROPERTY_SHARE_LINK_REVOKED' })
    })
    res.json({ success: true, message: 'Public share link revoked' })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/status', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.property.findFirst({ where: { id, organizationId, deletedAt: null } })
    if (!existing) throw createError('Property not found', 404)
    if (req.user?.role === 'AGENT' && existing.assignedAgentId !== userId) {
      throw createError('Insufficient permissions to update this property', 403)
    }

    const nextStatus = enumValue(req.body?.status, 'status', Object.values(PropertyStatus))
    validatePropertyTransition(existing.status, nextStatus)
    const property = await prisma.$transaction(async (tx) => {
      const updated = await tx.property.update({
        where: { id },
        data: {
          status: nextStatus,
          reservedUntil: nextStatus === PropertyStatus.RESERVED
            ? dateValue(req.body?.reservedUntil, 'reservedUntil') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            : existing.status === PropertyStatus.RESERVED ? null : undefined
        }
      })
      await logPropertyActivity(tx, {
        propertyId: id,
        userId,
        action: 'PROPERTY_STATUS_CHANGED',
        details: { before: existing.status, after: nextStatus }
      })
      await logAudit(tx, {
        userId,
        action: 'PROPERTY_STATUS_CHANGED',
        entityType: 'Property',
        entityId: id,
        details: { before: existing.status, after: nextStatus }
      })
      const recipients = await organizationRecipientIds(tx, organizationId, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: [existing.assignedAgentId || ''],
        excludeUserId: userId
      })
      await notifyUsers(tx, recipients, {
        organizationId,
        type: 'PROPERTY_STATUS_CHANGED',
        title: 'Property status updated',
        message: `${existing.title} changed from ${existing.status} to ${nextStatus}.`,
        entityType: 'Property',
        entityId: id,
        actionUrl: `/properties/${id}`,
        metadata: { before: existing.status, after: nextStatus }
      })
      return updated
    })
    res.json({ success: true, data: property, message: 'Property status updated successfully' })
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const assignedAgentId = optionalString(req.body?.assignedAgent, 'assignedAgent', 100)
      || optionalString(req.body?.assignedAgentId, 'assignedAgentId', 100)
    const ownerId = optionalString(req.body?.ownerId, 'ownerId', 100)
    await assertRelatedUsers(assignedAgentId, ownerId, organizationId)

    const property = await prisma.$transaction(async (tx) => {
      const created = await tx.property.create({
        data: {
          referenceNumber: optionalString(req.body?.referenceNumber, 'referenceNumber', 100) || `PROP-${Date.now().toString(36).toUpperCase()}`,
          title: requiredString(req.body?.title, 'title', 200),
          description: optionalString(req.body?.description, 'description', 5000),
          type: enumValue(req.body?.type, 'type', Object.values(PropertyType)),
          status: enumValue(req.body?.status, 'status', Object.values(PropertyStatus), PropertyStatus.AVAILABLE),
          classification: enumValue(req.body?.classification, 'classification', Object.values(PropertyClassification), PropertyClassification.SALE),
          address: optionalString(req.body?.address, 'address'),
          city: optionalString(req.body?.city, 'city', 120),
          state: optionalString(req.body?.state, 'state', 120),
          country: optionalString(req.body?.country, 'country', 120),
          postalCode: optionalString(req.body?.postalCode, 'postalCode', 30),
          latitude: numberValue(req.body?.latitude, 'latitude', { min: -90, max: 90 }),
          longitude: numberValue(req.body?.longitude, 'longitude', { min: -180, max: 180 }),
          area: numberValue(req.body?.area, 'area', { min: 0 }),
          areaUnit: enumValue(req.body?.areaUnit, 'areaUnit', Object.values(AreaUnit), AreaUnit.SQ_M),
          bedrooms: numberValue(req.body?.bedrooms, 'bedrooms', { min: 0 }) ?? 0,
          bathrooms: numberValue(req.body?.bathrooms, 'bathrooms', { min: 0 }) ?? 0,
          floors: numberValue(req.body?.floors, 'floors', { min: 0 }),
          yearBuilt: numberValue(req.body?.yearBuilt, 'yearBuilt', { min: 1800, max: 2100 }),
          condition: enumValue(req.body?.condition, 'condition', Object.values(PropertyCondition), PropertyCondition.GOOD),
          price: parseMoney(req.body?.price, 'price', { min: 0 }) || '0.00',
          currency: (optionalString(req.body?.currency, 'currency', 3) || 'USD').toUpperCase(),
          negotiable: booleanValue(req.body?.negotiable, 'negotiable'),
          featured: booleanValue(req.body?.featured, 'featured'),
          reservedUntil: dateValue(req.body?.reservedUntil, 'reservedUntil'),
          availableFrom: dateValue(req.body?.availableFrom, 'availableFrom'),
          occupancyStatus: req.body?.occupancyStatus
            ? enumValue(req.body.occupancyStatus, 'occupancyStatus', Object.values(OccupancyStatus))
            : undefined,
          operationalNotes: optionalString(req.body?.operationalNotes, 'operationalNotes', 5000),
          organizationId,
          ownerId,
          assignedAgentId
        }
      })
      await logPropertyActivity(tx, { propertyId: created.id, userId, action: 'PROPERTY_CREATED' })
      await logAudit(tx, { userId, action: 'PROPERTY_CREATED', entityType: 'Property', entityId: created.id })
      return created
    })
    res.status(201).json({ success: true, data: property, message: 'Property created successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(createError('A property with this reference number already exists', 409))
    }
    next(error)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.property.findFirst({ where: { id, organizationId, deletedAt: null } })
    if (!existing) throw createError('Property not found', 404)
    if (req.user?.role === 'AGENT' && existing.assignedAgentId !== userId) {
      throw createError('Insufficient permissions to update this property', 403)
    }

    const body = req.body as Record<string, unknown>
    const data: Prisma.PropertyUpdateInput = {}
    const changes: Record<string, unknown> = {}

    if (body.status !== undefined) {
      const nextStatus = enumValue(body.status, 'status', Object.values(PropertyStatus))
      validatePropertyTransition(existing.status, nextStatus)
      data.status = nextStatus
      changes.status = { before: existing.status, after: nextStatus }
    }
    if (body.title !== undefined) data.title = requiredString(body.title, 'title', 200)
    if (body.description !== undefined) data.description = optionalString(body.description, 'description', 5000)
    if (body.type !== undefined) data.type = enumValue(body.type, 'type', Object.values(PropertyType))
    if (body.classification !== undefined) data.classification = enumValue(body.classification, 'classification', Object.values(PropertyClassification))
    if (body.condition !== undefined) data.condition = enumValue(body.condition, 'condition', Object.values(PropertyCondition))
    if (body.areaUnit !== undefined) data.areaUnit = enumValue(body.areaUnit, 'areaUnit', Object.values(AreaUnit))
    if (body.occupancyStatus !== undefined) {
      data.occupancyStatus = body.occupancyStatus === ''
        ? null
        : enumValue(body.occupancyStatus, 'occupancyStatus', Object.values(OccupancyStatus))
      changes.occupancyStatus = { before: existing.occupancyStatus, after: body.occupancyStatus }
    }
    for (const field of ['address', 'city', 'state', 'country', 'postalCode', 'operationalNotes']) {
      if (body[field] !== undefined) {
        data[field as 'city'] = optionalString(body[field], field, field === 'operationalNotes' ? 5000 : 500)
      }
    }
    const nextCurrency = body.currency !== undefined
      ? (optionalString(body.currency, 'currency', 3) || 'USD').toUpperCase()
      : existing.currency
    if (body.currency !== undefined) data.currency = nextCurrency
    for (const field of ['latitude', 'longitude', 'area', 'bedrooms', 'bathrooms', 'floors', 'yearBuilt']) {
      if (body[field] !== undefined) data[field as 'price'] = numberValue(body[field], field, { min: field === 'latitude' ? -90 : undefined })
    }
    let nextPrice = existing.price.toString()
    if (body.price !== undefined) {
      nextPrice = parseMoney(body.price, 'price', { min: 0 })!
      data.price = nextPrice
    }
    const priceChange = (body.price !== undefined || body.currency !== undefined)
      ? priceChangeMetadata(
          { price: existing.price, currency: existing.currency },
          { price: nextPrice, currency: nextCurrency }
        )
      : null
    if (priceChange) {
      changes.price = { before: priceChange.oldPrice, after: priceChange.newPrice }
      changes.currency = { before: priceChange.oldCurrency, after: priceChange.newCurrency }
    }
    if (body.negotiable !== undefined) data.negotiable = booleanValue(body.negotiable, 'negotiable')
    if (body.featured !== undefined) data.featured = booleanValue(body.featured, 'featured')
    if (body.reservedUntil !== undefined) data.reservedUntil = dateValue(body.reservedUntil, 'reservedUntil')
    if (body.availableFrom !== undefined) data.availableFrom = dateValue(body.availableFrom, 'availableFrom')
    if (body.assignedAgent !== undefined || body.assignedAgentId !== undefined) {
      const assignedAgentId = optionalString(body.assignedAgentId ?? body.assignedAgent, 'assignedAgent', 100)
      await assertRelatedUsers(assignedAgentId, undefined, organizationId)
      data.assignedAgent = assignedAgentId ? { connect: { id: assignedAgentId } } : { disconnect: true }
      changes.assignedAgentId = { before: existing.assignedAgentId, after: assignedAgentId }
    }
    if (body.ownerId !== undefined) {
      const ownerId = optionalString(body.ownerId, 'ownerId', 100)
      await assertRelatedUsers(undefined, ownerId, organizationId)
      data.owner = ownerId ? { connect: { id: ownerId } } : { disconnect: true }
      changes.ownerId = { before: existing.ownerId, after: ownerId }
    }

    const property = await prisma.$transaction(async (tx) => {
      const updated = await tx.property.update({ where: { id }, data })
      if (priceChange) {
        const details = { ...priceChange }
        await logPropertyActivity(tx, { propertyId: id, userId, action: PROPERTY_PRICE_CHANGED, details })
        await logAudit(tx, { userId, action: PROPERTY_PRICE_CHANGED, entityType: 'Property', entityId: id, details })
      }
      if (Object.keys(changes).length) {
        await logPropertyActivity(tx, { propertyId: id, userId, action: 'PROPERTY_UPDATED', details: changes })
      }
      await logAudit(tx, { userId, action: 'PROPERTY_UPDATED', entityType: 'Property', entityId: id, details: changes })
      return updated
    })
    res.json({ success: true, data: property, message: 'Property updated successfully' })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const existing = await prisma.property.findFirst({ where: { id, organizationId, deletedAt: null } })
    if (!existing) throw createError('Property not found', 404)
    const role = req.user?.role
    const isAssignedAgent = role === 'AGENT' && existing.assignedAgentId === userId
    if (role !== 'ADMIN' && role !== 'MANAGER' && !isAssignedAgent) {
      throw createError('Insufficient permissions to archive this property', 403)
    }
    await prisma.$transaction(async (tx) => {
      await tx.property.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } })
      await logPropertyActivity(tx, { propertyId: id, userId, action: 'PROPERTY_ARCHIVED' })
      await logAudit(tx, { userId, action: 'PROPERTY_ARCHIVED', entityType: 'Property', entityId: id })
    })
    res.json({ success: true, message: 'Property archived successfully' })
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// Package 14 — floorplans & brochures
// ---------------------------------------------------------------------------

function attachmentContentUrl(propertyId: string, attachmentId: string): string {
  return `/api/properties/${propertyId}/attachments/${attachmentId}/content`
}

router.get('/:id/attachments', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    await findAccessibleProperty(id, req)
    const kindParam = req.query.kind
    const kind = !kindParam || String(kindParam) === 'ALL'
      ? undefined
      : parseAttachmentKind(kindParam)
    const attachments = await prisma.propertyDocument.findMany({
      where: {
        propertyId: id,
        deletedAt: null,
        ...(kind ? { kind } : { kind: { in: [PropertyAttachmentKind.FLOORPLAN, PropertyAttachmentKind.BROCHURE] } })
      },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 500
    })
    res.json({
      success: true,
      data: attachments.map((attachment) => serializeAttachment(
        attachment,
        attachment.storageKey ? attachmentContentUrl(id, attachment.id) : null
      ))
    })
  } catch (error) {
    next(error)
  }
})

/** Upload a document or link an external floorplan/brochure. */
router.post('/:id/attachments', attachmentUploadMiddleware, async (req, res, next) => {
  let storageKey: string | null = null
  try {
    const userId = userIdOf(req)
    const id = String(req.params.id)
    await findAccessibleProperty(id, req, { forWrite: true })
    const body = (req.body || {}) as Record<string, unknown>
    const kind = parseAttachmentKind(body.kind)
    const existing = await prisma.propertyDocument.findMany({
      where: { propertyId: id, deletedAt: null },
      select: { sortOrder: true },
      take: 500
    })
    const sortOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1

    let name: string
    let url: string
    let mimeType: string | null = null
    let originalName: string | null = null
    let size: number | null = null
    const file = req.file
    if (file) {
      validateDocumentFile(file)
      storageKey = createStorageKey(file.originalname)
      await writeDocument(storageKey, file.buffer)
      originalName = sanitizeOriginalName(file.originalname)
      mimeType = file.mimetype.toLowerCase()
      size = file.size
      name = optionalString(body.name, 'name', 200) || originalName
      url = storageKey
    } else {
      url = validateAttachmentUrl(body.url)
      name = requiredString(body.name, 'name', 200)
    }

    const created = await prisma.$transaction(async (tx) => {
      const attachment = await tx.propertyDocument.create({
        data: { propertyId: id, name, url, kind, mimeType, originalName, size, storageKey, sortOrder }
      })
      await logAudit(tx, {
        userId,
        action: 'PROPERTY_ATTACHMENT_ADDED',
        entityType: 'Property',
        entityId: id,
        details: { attachmentId: attachment.id, kind, source: file ? 'upload' : 'link' }
      })
      return attachment
    })
    res.status(201).json({
      success: true,
      data: serializeAttachment(created, storageKey ? attachmentContentUrl(id, created.id) : null),
      message: 'Attachment added successfully'
    })
  } catch (error) {
    if (storageKey) await removeDocument(storageKey)
    next(error)
  }
})

router.get('/:id/attachments/:attachmentId/content', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const attachmentId = String(req.params.attachmentId)
    await findAccessibleProperty(id, req)
    const attachment = await prisma.propertyDocument.findFirst({
      where: { id: attachmentId, propertyId: id, deletedAt: null },
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

router.delete('/:id/attachments/:attachmentId', async (req, res, next) => {
  try {
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const attachmentId = String(req.params.attachmentId)
    await findAccessibleProperty(id, req, { forWrite: true })
    const attachment = await prisma.propertyDocument.findFirst({
      where: { id: attachmentId, propertyId: id, deletedAt: null },
      select: { id: true, kind: true }
    })
    if (!attachment) throw createError('Attachment not found', 404)
    await prisma.$transaction(async (tx) => {
      await tx.propertyDocument.update({ where: { id: attachmentId }, data: { deletedAt: new Date() } })
      await logAudit(tx, {
        userId,
        action: 'PROPERTY_ATTACHMENT_REMOVED',
        entityType: 'Property',
        entityId: id,
        details: { attachmentId, kind: attachment.kind }
      })
    })
    // Physical files are retained for history, matching the image archive flow.
    res.json({ success: true, message: 'Attachment removed successfully' })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/images', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    await findAccessibleProperty(id, req)
    const images = await prisma.propertyImage.findMany({
      where: { propertyId: id, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 500
    })
    res.json({ success: true, data: images })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/images', imageUploadMiddleware, async (req, res, next) => {
  const storedKeys: string[] = []
  try {
    organizationIdOf(req) // ensure org context is present for the request
    const userId = userIdOf(req)
    const id = String(req.params.id)
    await findAccessibleProperty(id, req, { forWrite: true })
    const files = (req.files as Express.Multer.File[] | undefined) || []
    if (!files.length) throw createError('At least one image file is required', 400)

    const existing = await prisma.propertyImage.findMany({
      where: { propertyId: id, deletedAt: null },
      take: 500,
      select: { id: true, isPrimary: true, sortOrder: true }
    })
    const hasPrimary = existing.some((image) => image.isPrimary)
    let nextOrder = existing.reduce((max, image) => Math.max(max, image.sortOrder), -1) + 1

    const created: unknown[] = []
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      validateImageFile(file)
      const storageKey = createStorageKey(file.originalname)
      await writePropertyImage(storageKey, file.buffer)
      storedKeys.push(storageKey)
      const image = await prisma.propertyImage.create({
        data: {
          propertyId: id,
          url: storageKey,
          storageKey,
          originalName: sanitizeOriginalName(file.originalname),
          mimeType: file.mimetype.toLowerCase(),
          size: file.size,
          caption: optionalString((req.body as Record<string, unknown>)?.caption, 'caption', 200),
          isPrimary: !hasPrimary && index === 0,
          sortOrder: nextOrder++,
          uploadedById: userId
        }
      })
      created.push(image)
    }

    await logPropertyActivity(prisma, { propertyId: id, userId, action: 'PROPERTY_IMAGES_UPLOADED', details: { count: created.length } })
    await logAudit(prisma, { userId, action: 'PROPERTY_IMAGES_UPLOADED', entityType: 'Property', entityId: id, details: { count: created.length } })
    res.status(201).json({ success: true, data: created, message: `${created.length} image(s) uploaded successfully` })
  } catch (error) {
    await Promise.all(storedKeys.map((key) => removePropertyImage(key)))
    next(error)
  }
})

router.get('/:id/images/:imageId/content', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const imageId = String(req.params.imageId)
    await findAccessibleProperty(id, req)
    const image = await prisma.propertyImage.findFirst({
      where: { id: imageId, propertyId: id, deletedAt: null }
    })
    if (!image || !image.storageKey) throw createError('Image not found', 404)
    const buffer = await readPropertyImage(image.storageKey)
    res.setHeader('Content-Type', image.mimeType || 'application/octet-stream')
    res.setHeader('Content-Length', String(buffer.length))
    const disposition = String(req.query.download || '') === '1' ? 'attachment' : 'inline'
    res.setHeader('Content-Disposition', `${disposition}; filename="${sanitizeOriginalName(image.originalName || 'image')}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(buffer)
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/images/reorder', async (req, res, next) => {
  try {
    const userId = userIdOf(req)
    const id = String(req.params.id)
    await findAccessibleProperty(id, req, { forWrite: true })
    if (req.user?.role === 'AGENT') {
      const property = await prisma.property.findFirst({ where: { id, deletedAt: null }, select: { assignedAgentId: true } })
      if (!property || property.assignedAgentId !== userId) throw createError('Insufficient permissions to update this property', 403)
    }
    const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map((value: unknown) => String(value)) : []
    if (!orderedIds.length) throw createError('orderedIds is required', 400)
    const images = await prisma.propertyImage.findMany({ where: { propertyId: id, deletedAt: null }, take: 500, select: { id: true } })
    const existingIds = new Set(images.map((image) => image.id))
    if (orderedIds.length !== images.length || orderedIds.some((imageId: string) => !existingIds.has(imageId))) {
      throw createError('orderedIds must include every active image exactly once', 400)
    }
    await prisma.$transaction(async (tx) => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await tx.propertyImage.update({ where: { id: orderedIds[index] }, data: { sortOrder: index } })
      }
      await logAudit(tx, { userId, action: 'PROPERTY_IMAGES_REORDERED', entityType: 'Property', entityId: id })
    })
    const updated = await prisma.propertyImage.findMany({ where: { propertyId: id, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 500 })
    res.json({ success: true, data: updated, message: 'Images reordered successfully' })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/images/:imageId', async (req, res, next) => {
  try {
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const imageId = String(req.params.imageId)
    await findAccessibleProperty(id, req, { forWrite: true })
    if (req.user?.role === 'AGENT') {
      const property = await prisma.property.findFirst({ where: { id, deletedAt: null }, select: { assignedAgentId: true } })
      if (!property || property.assignedAgentId !== userId) throw createError('Insufficient permissions to update this property', 403)
    }
    const existing = await prisma.propertyImage.findFirst({ where: { id: imageId, propertyId: id, deletedAt: null } })
    if (!existing) throw createError('Image not found', 404)

    if (req.body?.isPrimary === true) {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.propertyImage.updateMany({ where: { propertyId: id, deletedAt: null, isPrimary: true }, data: { isPrimary: false } })
        const image = await tx.propertyImage.update({ where: { id: imageId }, data: { isPrimary: true } })
        await logAudit(tx, { userId, action: 'PROPERTY_IMAGE_PRIMARY_SET', entityType: 'PropertyImage', entityId: imageId, details: { propertyId: id } })
        return image
      })
      return res.json({ success: true, data: updated, message: 'Primary image updated' })
    }

    const data: Prisma.PropertyImageUpdateInput = {}
    if (req.body?.caption !== undefined) data.caption = optionalString(req.body.caption, 'caption', 200)
    if (!Object.keys(data).length) throw createError('No supported image changes provided', 400)
    const updated = await prisma.propertyImage.update({ where: { id: imageId }, data })
    res.json({ success: true, data: updated, message: 'Image updated successfully' })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id/images/:imageId', async (req, res, next) => {
  try {
    const userId = userIdOf(req)
    const id = String(req.params.id)
    const imageId = String(req.params.imageId)
    await findAccessibleProperty(id, req, { forWrite: true })
    if (req.user?.role === 'AGENT') {
      const property = await prisma.property.findFirst({ where: { id, deletedAt: null }, select: { assignedAgentId: true } })
      if (!property || property.assignedAgentId !== userId) throw createError('Insufficient permissions to update this property', 403)
    }
    const existing = await prisma.propertyImage.findFirst({ where: { id: imageId, propertyId: id, deletedAt: null } })
    if (!existing) throw createError('Image not found', 404)

    await prisma.$transaction(async (tx) => {
      await tx.propertyImage.update({ where: { id: imageId }, data: { deletedAt: new Date(), isPrimary: false } })
      if (existing.isPrimary) {
        const replacement = await tx.propertyImage.findFirst({
          where: { propertyId: id, deletedAt: null, id: { not: imageId } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
        })
        if (replacement) await tx.propertyImage.update({ where: { id: replacement.id }, data: { isPrimary: true } })
      }
      await logAudit(tx, { userId, action: 'PROPERTY_IMAGE_ARCHIVED', entityType: 'PropertyImage', entityId: imageId, details: { propertyId: id } })
    })
    // Keep stored file for safety/history; record is archived.
    res.json({ success: true, message: 'Image removed successfully' })
  } catch (error) {
    next(error)
  }
})

export default router
