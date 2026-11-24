import { Router } from 'express'
import { AppointmentStatus, DealStatus, LeadStatus, Prisma, Role } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { appointmentScope } from '../utils/appointments'
import { leaderboardCsv, rankLeaderboard, isQuotaPeriod, type QuotaPeriod } from '../utils/leaderboard'
import { leadScope, organizationIdOf, roleOf, userIdOf } from '../utils/scope'
import { dateValue } from '../utils/validation'

const router = Router()
router.use(authMiddleware)

function periodRange(period: QuotaPeriod): Date {
  const now = new Date()
  const start = new Date(now)
  if (period === 'month') start.setUTCDate(1)
  if (period === 'quarter') start.setUTCMonth(Math.floor(now.getUTCMonth() / 3) * 3, 1)
  if (period === 'year') start.setUTCMonth(0, 1)
  start.setUTCHours(0, 0, 0, 0)
  return start
}

router.get('/', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const role = roleOf(req)
    const callerId = userIdOf(req)
    const period: QuotaPeriod = isQuotaPeriod(req.query.period) ? req.query.period : 'month'
    const explicitFrom = dateValue(req.query.from, 'from')
    const explicitTo = dateValue(req.query.to, 'to')
    const from = explicitFrom || periodRange(period)
    const to = explicitTo || new Date()
    if (from > to) throw createError('from must be before to', 400)
    const months = explicitFrom && explicitTo
      ? Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (30 * 24 * 60 * 60 * 1000)))
      : undefined
    const range = { createdAt: { gte: from, lte: to } }

    const caller = role === Role.TEAM_LEAD
      ? await prisma.user.findFirst({
        where: { id: callerId, organizationId },
        select: { teamId: true }
      })
      : null

    const userWhere: Prisma.UserWhereInput = {
      organizationId,
      deletedAt: null,
      isActive: true,
      role: { in: [Role.AGENT, Role.TEAM_LEAD, Role.MANAGER] },
      ...(role === Role.AGENT ? { id: callerId } : {}),
      ...(role === Role.TEAM_LEAD ? { OR: [{ id: callerId }, ...(caller?.teamId ? [{ teamId: caller.teamId }] : [])] } : {}),
      ...(req.query.teamId && role !== Role.AGENT && role !== Role.TEAM_LEAD ? { teamId: String(req.query.teamId) } : {})
    }

    const users = await prisma.user.findMany({
      where: userWhere,
      select: { id: true, firstName: true, email: true, role: true, monthlyTargetAmount: true },
      orderBy: { firstName: 'asc' }
    })
    const userIds = users.map((user) => user.id)
    const [deals, leads, appointments] = await Promise.all([
      prisma.deal.findMany({
        where: {
          organizationId,
          deletedAt: null,
          status: { not: DealStatus.CANCELLED },
          userId: { in: userIds },
          ...range
        },
        select: { userId: true, amount: true, baseAmount: true, currency: true }
      }),
      prisma.lead.groupBy({
        by: ['assignedToId'],
        where: { status: LeadStatus.WON, assignedToId: { in: userIds }, deletedAt: null, ...leadScope(organizationId), ...range },
        _count: { _all: true }
      }),
      prisma.appointment.groupBy({
        by: ['userId'],
        where: { status: AppointmentStatus.COMPLETED, userId: { in: userIds }, ...appointmentScope(organizationId), ...range },
        _count: { _all: true }
      })
    ])

    const dealTotals = new Map<string, { value: number; count: number; byCurrency: Map<string, number> }>()
    for (const deal of deals) {
      const current = dealTotals.get(deal.userId) || { value: 0, count: 0, byCurrency: new Map<string, number>() }
      const value = Number(deal.baseAmount ?? deal.amount)
      current.value += value
      current.count += 1
      current.byCurrency.set(deal.currency, (current.byCurrency.get(deal.currency) || 0) + value)
      dealTotals.set(deal.userId, current)
    }
    const leadCounts = new Map(leads.map((row) => [row.assignedToId, row._count._all]))
    const appointmentCounts = new Map(appointments.map((row) => [row.userId, row._count._all]))

    const rows = rankLeaderboard(users.map((user) => {
      const totals = dealTotals.get(user.id)
      return {
        userId: user.id,
        name: user.firstName || user.email,
        role: user.role,
        monthlyTarget: user.monthlyTargetAmount ? user.monthlyTargetAmount.toFixed(2) : null,
        value: (totals?.value ?? 0).toFixed(2),
        dealCount: totals?.count ?? 0,
        wonLeadCount: leadCounts.get(user.id) ?? 0,
        completedAppointmentCount: appointmentCounts.get(user.id) ?? 0,
        currencyBreakdown: [...(totals?.byCurrency ?? new Map<string, number>())]
          .map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) }))
      }
    }), { period, months })

    if (req.query.format === 'csv') {
      const csv = leaderboardCsv(rows, req.query.language === 'ar' ? 'ar' : 'en')
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="leaderboard-${period}-${new Date().toISOString().slice(0, 10)}.csv"`)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      return res.send(csv)
    }

    res.json({
      success: true,
      data: {
        period,
        from: from.toISOString(),
        to: to.toISOString(),
        scope: role === Role.AGENT ? 'SELF' : role === Role.TEAM_LEAD ? 'TEAM' : 'ORGANIZATION',
        rows
      }
    })
  } catch (error) {
    next(error)
  }
})

export default router
