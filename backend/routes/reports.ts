import { Router } from 'express'
import {
  AppointmentStatus,
  DealStatus,
  ExpenseStatus,
  LeadStatus,
  MaintenanceStatus,
  PaymentStatus,
  Prisma,
  PropertyStatus
} from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware, requireRole } from '../middleware/auth'
import { REPORT_ROLES, leadScope, organizationIdOf } from '../utils/scope'
import { dateValue } from '../utils/validation'
import { sumMoney } from '../utils/money'
import { appointmentScope } from '../utils/appointments'
import { summarizeCurrencyAmounts } from '../utils/fx'
import { buildFunnelMetrics, uncontactedLeadCsv, uncontactedLeadWhere } from '../utils/reportMetrics'

const router = Router()
router.use(authMiddleware, requireRole(REPORT_ROLES))

interface DateRange {
  createdAt?: { gte?: Date; lte?: Date }
}

function dateRange(query: Record<string, unknown>): DateRange {
  const from = dateValue(query.from, 'from')
  const to = dateValue(query.to, 'to')
  if (!from && !to) return {}
  return { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
}

function moneyString(value: Prisma.Decimal | null | undefined): string {
  return value ? value.toString() : '0.00'
}

async function funnelAndSla(organizationId: string): Promise<Record<string, unknown>> {
  const now = new Date()
  const [leadRows, dealRows, uncontactedWhere] = [
    await prisma.lead.groupBy({
      by: ['status'],
      where: { deletedAt: null, ...leadScope(organizationId) },
      _count: { _all: true }
    }),
    await prisma.deal.groupBy({
      by: ['status'],
      where: { organizationId, deletedAt: null },
      _count: { _all: true }
    }),
    uncontactedLeadWhere(organizationId, { now })
  ]
  const leadCounts: Record<string, number> = {}
  const dealCounts: Record<string, number> = {}
  for (const row of leadRows) leadCounts[row.status] = row._count._all
  for (const row of dealRows) dealCounts[row.status] = row._count._all

  const [uncontactedCount, uncontacted] = await Promise.all([
    prisma.lead.count({ where: uncontactedWhere }),
    prisma.lead.findMany({
      where: uncontactedWhere,
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        createdAt: true,
        assignedTo: { select: { email: true } }
      }
    })
  ])

  return {
    funnel: buildFunnelMetrics({ leadCounts, dealCounts }),
    sla: {
      uncontactedCount,
      hours: 24,
      uncontactedLeads: uncontacted.map((lead) => ({
        ...lead,
        ageHours: Math.max(0, Math.floor((now.getTime() - lead.createdAt.getTime()) / 3600000))
      }))
    }
  }
}

router.get('/summary', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const range = dateRange(req.query as Record<string, unknown>)
    const propertyWhere = { organizationId, deletedAt: null, ...range }
    const dealWhere = { organizationId, deletedAt: null, ...range }

    const [
      propertyCounts,
      dealCounts,
      paymentSums,
      expenseSums,
      commissionSums,
      maintenanceCounts,
      maintenanceCost,
      propertiesByStatus,
      propertiesByType,
      propertiesByCity
    ] = await Promise.all([
      prisma.property.count({ where: propertyWhere }),
      prisma.deal.findMany({
        where: dealWhere,
        take: 10000,
        select: { status: true }
      }),
      prisma.payment.groupBy({
        by: ['currency'],
        where: { deletedAt: null, status: PaymentStatus.COMPLETED, deal: { organizationId }, ...range },
        _sum: { amount: true, baseAmount: true }
      }),
      prisma.expense.groupBy({
        by: ['currency'],
        where: { deletedAt: null, status: { not: ExpenseStatus.CANCELLED }, ...(await expenseScope(organizationId)), ...range },
        _sum: { amount: true, baseAmount: true }
      }),
      prisma.commission.groupBy({
        by: ['currency'],
        where: { deletedAt: null, deal: { organizationId }, ...range },
        _sum: { amount: true, baseAmount: true }
      }),
      prisma.maintenanceRequest.groupBy({
        by: ['status'],
        where: { organizationId, deletedAt: null, ...range },
        _count: { _all: true }
      }),
      prisma.maintenanceRequest.aggregate({
        where: { organizationId, deletedAt: null, ...range },
        _sum: { cost: true }
      }),
      prisma.property.groupBy({
        by: ['status'],
        where: propertyWhere,
        _count: { _all: true }
      }),
      prisma.property.groupBy({
        by: ['type'],
        where: propertyWhere,
        _count: { _all: true }
      }),
      prisma.property.groupBy({
        by: ['city'],
        where: propertyWhere,
        _count: { _all: true }
      })
    ])

    const fxSummary = await summarizeCurrencyAmounts(
      organizationId,
      paymentSums.map((row) => ({ currency: row.currency, amount: moneyString(row._sum.amount) }))
    )

    const available = propertiesByStatus.find((row) => row.status === PropertyStatus.AVAILABLE)?._count._all || 0
    const activeDeals = dealCounts.filter((deal) => deal.status === DealStatus.ACTIVE || deal.status === DealStatus.PENDING).length
    const completedDeals = dealCounts.filter((deal) => deal.status === DealStatus.COMPLETED).length

    const funnelSla = await funnelAndSla(organizationId)
    res.json({
      success: true,
      data: {
        ...funnelSla,
        properties: {
          total: propertyCounts,
          available,
          unavailable: propertyCounts - available,
          byStatus: propertiesByStatus,
          byType: propertiesByType,
          byCity: propertiesByCity
        },
        deals: { total: dealCounts.length, active: activeDeals, completed: completedDeals },
        finance: {
          payments: paymentSums.map((row) => ({ currency: row.currency, amount: moneyString(row._sum.amount), baseAmount: moneyString(row._sum.baseAmount) })),
          expenses: expenseSums.map((row) => ({ currency: row.currency, amount: moneyString(row._sum.amount), baseAmount: moneyString(row._sum.baseAmount) })),
          commissions: commissionSums.map((row) => ({ currency: row.currency, amount: moneyString(row._sum.amount), baseAmount: moneyString(row._sum.baseAmount) })),
          paymentTotalBase: sumMoney(paymentSums.map((row) => moneyString(row._sum.baseAmount || row._sum.amount))),
          expenseTotalBase: sumMoney(expenseSums.map((row) => moneyString(row._sum.baseAmount || row._sum.amount))),
          fx: {
            baseCurrency: fxSummary.baseCurrency,
            convertedPaymentTotal: fxSummary.convertedTotal,
            missingCurrencies: fxSummary.missingCurrencies,
            hasRates: fxSummary.hasRates
          }
        },
        maintenance: {
          byStatus: maintenanceCounts,
          totalCost: moneyString(maintenanceCost._sum.cost)
        }
      }
    })
  } catch (error) {
    next(error)
  }
})

async function expenseScope(organizationId: string): Promise<Prisma.ExpenseWhereInput> {
  return {
    AND: [
      { OR: [{ property: { organizationId } }, { deal: { organizationId } }, { responsible: { organizationId } }] },
      { OR: [{ propertyId: null }, { property: { organizationId } }] },
      { OR: [{ dealId: null }, { deal: { organizationId } }] },
      { OR: [{ responsibleId: null }, { responsible: { organizationId } }] }
    ]
  }
}

router.get('/financial', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const range = dateRange(req.query as Record<string, unknown>)
    const [deals, payments, expenses, commissions] = await Promise.all([
      prisma.deal.groupBy({
        by: ['currency', 'status'],
        where: { organizationId, deletedAt: null, ...range },
        _sum: { amount: true },
        _count: { _all: true }
      }),
      prisma.payment.groupBy({
        by: ['currency', 'status'],
        where: { deletedAt: null, deal: { organizationId }, ...range },
        _sum: { amount: true, baseAmount: true },
        _count: { _all: true }
      }),
      prisma.expense.groupBy({
        by: ['currency', 'status'],
        where: { deletedAt: null, ...(await expenseScope(organizationId)), ...range },
        _sum: { amount: true, baseAmount: true },
        _count: { _all: true }
      }),
      prisma.commission.groupBy({
        by: ['currency', 'status'],
        where: { deletedAt: null, deal: { organizationId }, ...range },
        _sum: { amount: true, baseAmount: true },
        _count: { _all: true }
      })
    ])
    res.json({
      success: true,
      data: {
        dealValue: deals.map((row) => ({ currency: row.currency, status: row.status, amount: moneyString(row._sum.amount), count: row._count._all })),
        cashReceived: payments.filter((row) => row.status === PaymentStatus.COMPLETED).map((row) => ({ currency: row.currency, amount: moneyString(row._sum.amount), baseAmount: moneyString(row._sum.baseAmount) })),
        outstandingByStatus: payments.filter((row) => row.status !== PaymentStatus.COMPLETED).map((row) => ({ currency: row.currency, status: row.status, amount: moneyString(row._sum.amount) })),
        expenses: expenses.map((row) => ({ currency: row.currency, status: row.status, amount: moneyString(row._sum.amount), baseAmount: moneyString(row._sum.baseAmount) })),
        commissions: commissions.map((row) => ({ currency: row.currency, status: row.status, amount: moneyString(row._sum.amount), baseAmount: moneyString(row._sum.baseAmount) }))
      }
    })
  } catch (error) {
    next(error)
  }
})

router.get('/properties', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const range = dateRange(req.query as Record<string, unknown>)
    const where = { organizationId, deletedAt: null, ...range }
    const [byStatus, byType, byCity, activityCount, maintenanceCost] = await Promise.all([
      prisma.property.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.property.groupBy({ by: ['type'], where, _count: { _all: true } }),
      prisma.property.groupBy({ by: ['city'], where, _count: { _all: true } }),
      prisma.propertyActivity.count({ where: { property: { organizationId }, ...range } }),
      prisma.maintenanceRequest.groupBy({
        by: ['propertyId'],
        where: { organizationId, deletedAt: null, ...range },
        _sum: { cost: true }
      })
    ])
    res.json({
      success: true,
      data: {
        byStatus,
        byType,
        byCity,
        activityCount,
        maintenanceCosts: maintenanceCost.map((row) => ({ propertyId: row.propertyId, cost: moneyString(row._sum.cost) }))
      }
    })
  } catch (error) {
    next(error)
  }
})

router.get('/team', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const range = dateRange(req.query as Record<string, unknown>)
    const [deals, leads, appointments] = await Promise.all([
      prisma.deal.groupBy({
        by: ['userId', 'currency'],
        where: { organizationId, deletedAt: null, ...range },
        _count: { _all: true },
        _sum: { amount: true }
      }),
      prisma.lead.groupBy({
        by: ['assignedToId', 'status'],
        where: { deletedAt: null, ...leadScope(organizationId), ...range },
        _count: { _all: true }
      }),
      prisma.appointment.groupBy({
        by: ['userId', 'status'],
        where: { ...appointmentScope(organizationId), ...range },
        _count: { _all: true }
      })
    ])
    const funnelSla = await funnelAndSla(organizationId)
    res.json({
      success: true,
      data: {
        ...funnelSla,
        deals: deals.map((row) => ({
          userId: row.userId,
          currency: row.currency,
          count: row._count._all,
          value: moneyString(row._sum.amount)
        })),
        leads: leads.map((row) => ({ userId: row.assignedToId, status: row.status, count: row._count._all, converted: row.status === LeadStatus.WON })),
        appointments: appointments.map((row) => ({ userId: row.userId, status: row.status, count: row._count._all, completed: row.status === AppointmentStatus.COMPLETED })),
        maintenanceStatuses: Object.values(MaintenanceStatus)
      }
    })
  } catch (error) {
    next(error)
  }
})

router.get('/uncontacted-leads', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const now = new Date()
    const rows = await prisma.lead.findMany({
      where: uncontactedLeadWhere(organizationId, { now }),
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        createdAt: true,
        assignedTo: { select: { email: true } }
      }
    })
    const csv = uncontactedLeadCsv(rows, now)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="uncontacted-leads-${now.toISOString().slice(0, 10)}.csv"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(`\uFEFF${csv}`)
  } catch (error) {
    next(error)
  }
})

export default router
