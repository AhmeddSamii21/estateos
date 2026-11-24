import { Router } from 'express'
import { prisma } from '../prisma'
import { authMiddleware } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { buildImportPreview, importHeaders, importTemplate } from '../utils/csvImport'
import { LEAD_IMPORT_FIELDS } from '../utils/leadImport'
import { PROPERTY_IMPORT_FIELDS } from '../utils/propertyImport'

const router = Router()
router.use(authMiddleware)

export const IMPORT_WIZARD_STEPS = ['upload', 'validate', 'review', 'commit'] as const
export type ImportKind = 'properties' | 'leads'
const MAX_ROWS = 500

function fieldsFor(kind: ImportKind) {
  return kind === 'properties' ? PROPERTY_IMPORT_FIELDS : LEAD_IMPORT_FIELDS
}

function uniqueField(kind: ImportKind): string {
  return kind === 'properties' ? 'referenceNumber' : 'email'
}

function escapeCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function rejectedRowsCsv(preview: ReturnType<typeof buildImportPreview>): string {
  const lines = ['row,field,message,value']
  for (const row of preview.rows) {
    for (const issue of row.errors) {
      lines.push([row.row, issue.field, issue.message, row.values?.[issue.field] ?? ''].map(escapeCsvCell).join(','))
    }
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

router.get('/template', (req, res, next) => {
  try {
    const kind = req.query.kind === 'leads' ? 'leads' : req.query.kind === 'properties' ? 'properties' : null
    if (!kind) throw createError('kind must be properties or leads', 400)
    const csv = importTemplate(fieldsFor(kind))
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${kind}-import-template.csv"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(csv)
  } catch (error) {
    next(error)
  }
})

router.post('/validate', (req, res, next) => {
  try {
    const kind = req.body?.kind === 'leads' ? 'leads' : req.body?.kind === 'properties' ? 'properties' : null
    if (!kind) throw createError('kind must be properties or leads', 400)
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : ''
    if (!csv.trim()) throw createError('CSV content is required', 400)

    const expectedHeaders = importHeaders(fieldsFor(kind))
    const preview = buildImportPreview(csv, fieldsFor(kind))
    if (preview.rows.length > MAX_ROWS) {
      throw createError(`A maximum of ${MAX_ROWS} rows can be validated at once`, 400)
    }

    const normalized = new Map(preview.headers.map((header) => [header.trim().toLowerCase().replace(/[\s_-]+/g, ''), header]))
    const missingHeaders = expectedHeaders.filter((header) => !normalized.has(header.toLowerCase().replace(/[\s_-]+/g, '')))

    // Duplicate detection is applied after schema validation so the wizard can
    // block ambiguous rows before they ever reach the committing endpoint.
    const keyField = uniqueField(kind)
    const seen = new Map<string, number>()
    for (const row of preview.rows) {
      const raw = row.values?.[keyField]
      if (raw === undefined || raw === null || String(raw).trim() === '') continue
      const key = String(raw).trim().toLowerCase()
      if (seen.has(key)) {
        row.errors.push({ field: keyField, message: `${keyField} is duplicated in this file` })
      } else {
        seen.set(key, row.row)
      }
    }

    const invalidCount = preview.rows.filter((row) => row.errors.length > 0).length
    const validCount = preview.rows.length - invalidCount
    const errorsByField: Record<string, number> = {}
    for (const row of preview.rows) {
      for (const issue of row.errors) errorsByField[issue.field] = (errorsByField[issue.field] || 0) + 1
    }

    res.json({
      success: true,
      data: {
        kind,
        steps: IMPORT_WIZARD_STEPS,
        stage: 'review',
        headers: preview.headers,
        expectedHeaders,
        missingHeaders,
        rows: preview.rows,
        validCount,
        invalidCount,
        errorsByField,
        duplicateCount: Object.entries(errorsByField)
          .filter(([field]) => field === keyField)
          .reduce((total, [, count]) => total + count, 0),
        rejectedRowsCsv: rejectedRowsCsv(preview),
        commitEndpoint: kind === 'properties' ? '/api/properties/import' : '/api/leads/import',
        canCommit: validCount > 0 && missingHeaders.length === 0
      }
    })
  } catch (error) {
    next(error)
  }
})

router.get('/statistics', async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId
    if (!organizationId) throw createError('Organization context is required', 403)
    const [properties, leads] = await Promise.all([
      prisma.property.count({ where: { organizationId, deletedAt: null } }),
      prisma.lead.count({ where: { deletedAt: null, assignedTo: { organizationId } } })
    ])
    res.json({ success: true, data: { properties, leads, maxRows: MAX_ROWS } })
  } catch (error) {
    next(error)
  }
})

export default router
