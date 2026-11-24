import { Router, type Request, type Response } from 'express'
import { Role } from '@prisma/client'
import { authMiddleware, requireRole } from '../middleware/auth'
import { MANAGEMENT_ROLES, leadScope, organizationIdOf, ownerReadScope, userIdOf } from '../utils/scope'
import { runReminders } from '../services/reminders'
import { appointmentScope } from '../utils/appointments'
import { buildSnapshot, snapshotFilename } from '../utils/snapshot'
import { logAudit } from '../utils/audit'
import { prisma } from '../prisma'
import { createError } from '../middleware/errorHandler'

const router = Router()
router.use(authMiddleware, requireRole(MANAGEMENT_ROLES))

const EXPORT_PAGE_SIZE = 500

async function paged<T>(fetch: (args: { skip: number; take: number }) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = []
  for (let skip = 0; skip < 50000; skip += EXPORT_PAGE_SIZE) {
    const page = await fetch({ skip, take: EXPORT_PAGE_SIZE })
    rows.push(...page)
    if (page.length < EXPORT_PAGE_SIZE) break
  }
  return rows
}

function expenseScope(organizationId: string) {
  return {
    AND: [
      { OR: [{ property: { organizationId } }, { deal: { organizationId } }, { responsible: { organizationId } }] },
      { OR: [{ propertyId: null }, { property: { organizationId } }] },
      { OR: [{ dealId: null }, { deal: { organizationId } }] },
      { OR: [{ responsibleId: null }, { responsible: { organizationId } }] }
    ]
  }
}

router.post('/run-reminders', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const result = await runReminders(new Date(), { organizationIds: [organizationId] })
    res.json({ success: true, data: result, message: 'Reminder run completed' })
  } catch (error) {
    next(error)
  }
})

// Administrative JSON backup. Every model is tenant-scoped, paged and built
// through the sanitizer; users (password hashes/token versions) are never read.
router.get('/export-snapshot', requireRole([Role.ADMIN]), async (req: Request, res: Response, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const organization = await prisma.organization.findFirst({
      where: { id: organizationId, isActive: true, deletedAt: null },
      select: { id: true, name: true, slug: true, currency: true, baseCurrency: true, createdAt: true }
    })
    if (!organization) throw createError('Organization not found', 404)

    const [properties, owners, leads, deals, appointments, payments, expenses, commissions, settings] = await Promise.all([
      paged((args) => prisma.property.findMany({ where: { organizationId, deletedAt: null }, orderBy: { createdAt: 'asc' }, ...args })),
      paged((args) => prisma.owner.findMany({ where: { ...ownerReadScope(organizationId), deletedAt: null }, orderBy: { createdAt: 'asc' }, ...args })),
      paged((args) => prisma.lead.findMany({ where: { ...leadScope(organizationId), deletedAt: null }, orderBy: { createdAt: 'asc' }, ...args })),
      paged((args) => prisma.deal.findMany({ where: { organizationId, deletedAt: null }, orderBy: { createdAt: 'asc' }, ...args })),
      paged((args) => prisma.appointment.findMany({ where: appointmentScope(organizationId), orderBy: { startsAt: 'asc' }, ...args })),
      paged((args) => prisma.payment.findMany({ where: { deletedAt: null, deal: { organizationId } }, orderBy: { createdAt: 'asc' }, ...args })),
      paged((args) => prisma.expense.findMany({ where: { deletedAt: null, ...expenseScope(organizationId) }, orderBy: { createdAt: 'asc' }, ...args })),
      paged((args) => prisma.commission.findMany({ where: { deletedAt: null, deal: { organizationId } }, orderBy: { createdAt: 'asc' }, ...args })),
      paged((args) => prisma.settings.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' }, ...args }))
    ])

    const snapshot = buildSnapshot({
      organizationId,
      organization,
      properties,
      owners,
      leads,
      deals,
      appointments,
      payments,
      expenses,
      commissions,
      settings
    })

    await logAudit(prisma, {
      userId,
      action: 'ADMIN_SNAPSHOT_EXPORTED',
      entityType: 'Organization',
      entityId: organizationId,
      details: snapshot.counts as Record<string, unknown>
    })

    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${snapshotFilename(organizationId)}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(JSON.stringify(snapshot, null, 2))
  } catch (error) {
    next(error)
  }
})

export default router
