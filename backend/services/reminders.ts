import { AppointmentStatus, DealStatus, DealType, LeadStatus, MaintenanceRecurrenceInterval, MaintenanceStatus, PaymentStatus } from '@prisma/client'
import { prisma } from '../prisma'
import { createNotifications, organizationRecipientIds, type NotificationInput } from './notifications'
import { leadScope } from '../utils/scope'
import { followUpBucket, startOfUtcDay } from '../utils/followUps'
import { UNCONTACTED_SLA_HOURS, uncontactedLeadWhere } from '../utils/reportMetrics'
import { daysUntilLeaseEnd, isLeaseRenewalDue, leaseRenewalState, MAX_RENEWAL_NOTICE_DAYS } from '../utils/leases'

const DEFAULT_DUE_SOON_HOURS = 48
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000

export function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function isOverdue(dueAt: Date, now: Date): boolean {
  return dueAt.getTime() < new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime()
}

function leadLabel(lead: { firstName: string; lastName?: string | null }): string {
  return `${lead.firstName}${lead.lastName ? ` ${lead.lastName}` : ''}`
}

export interface ReminderRunResult {
  organizations: number
  paymentReminders: number
  appointmentReminders: number
  appointmentUpcomingReminders: number
  leadFollowUpReminders: number
  leaseRenewalReminders: number
  maintenanceReminders: number
}

export interface ReminderRunOptions {
  /** Restrict a manual trigger to the caller's organization. */
  organizationIds?: string[]
}

/**
 * Notifications are deduplicated per entity and per local calendar day, so a
 * periodic run never repeats the same reminder even when the 5-minute generic
 * notification dedupe window has elapsed.
 */
async function createDailyReminders(inputs: NotificationInput[], reminderDay: string): Promise<number> {
  let created = 0
  for (const input of inputs) {
    const existing = await prisma.notification.findFirst({
      where: {
        userId: input.userId,
        organizationId: input.organizationId || null,
        type: input.type,
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        metadata: { path: ['reminderDay'], equals: reminderDay }
      },
      select: { id: true }
    })
    if (existing) continue
    created += await createNotifications(prisma, [input])
  }
  return created
}

export async function runReminders(now = new Date(), options: ReminderRunOptions = {}): Promise<ReminderRunResult> {
  const dueSoonHours = Number(process.env.REMINDER_DUE_SOON_HOURS || DEFAULT_DUE_SOON_HOURS)
  const dueSoonMs = (Number.isFinite(dueSoonHours) && dueSoonHours > 0 ? dueSoonHours : DEFAULT_DUE_SOON_HOURS) * 60 * 60 * 1000
  const dueSoonCutoff = new Date(now.getTime() + dueSoonMs)
  // Package 33: an appointment inside the next 24 hours gets a distinct
  // upcoming alert. The generic reminder window remains independently
  // configurable for installments and leases.
  const appointmentSoonCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const todayKey = toDayKey(now)
  const endOfToday = new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000)
  const maxLeaseWindow = new Date(now.getTime() + MAX_RENEWAL_NOTICE_DAYS * 24 * 60 * 60 * 1000)
  const result: ReminderRunResult = {
    organizations: 0,
    paymentReminders: 0,
    appointmentReminders: 0,
    appointmentUpcomingReminders: 0,
    leadFollowUpReminders: 0,
    leaseRenewalReminders: 0,
    maintenanceReminders: 0
  }

  const organizations = await prisma.organization.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ...(options.organizationIds ? { id: { in: options.organizationIds } } : {})
    },
    take: 1000,
    select: { id: true }
  })

  for (const org of organizations) {
    result.organizations += 1

    // 1) Unresolved payments due soon or overdue. Deals carry the due date;
    // legacy rows without one fall back to the recorded payment date.
    const payments = await prisma.payment.findMany({
      where: {
        deletedAt: null,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
        OR: [
          { deal: { dueAt: { not: null, lte: dueSoonCutoff } } },
          { paidAt: { not: null, lte: dueSoonCutoff } }
        ],
        deal: { organizationId: org.id, deletedAt: null }
      },
      take: 500,
      select: {
        id: true,
        dealId: true,
        amount: true,
        currency: true,
        status: true,
        paidAt: true,
        deal: { select: { id: true, referenceNumber: true, userId: true, organizationId: true, dueAt: true } }
      }
    })

    for (const payment of payments) {
      const dueAt = payment.deal.dueAt ?? payment.paidAt
      if (!dueAt) continue
      const overdue = isOverdue(dueAt, now)
      const kind = overdue ? 'overdue' : 'due-soon'
      const recipients = await organizationRecipientIds(prisma, org.id, {
        roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'],
        includeUserIds: [payment.deal.userId]
      })
      if (!recipients.length) continue
      const reference = payment.deal.referenceNumber || 'a deal'
      const title = overdue ? 'Payment overdue' : 'Payment due soon'
      const message = overdue
        ? `${payment.amount.toString()} ${payment.currency} for ${reference} is overdue (due ${toDayKey(dueAt)}).`
        : `${payment.amount.toString()} ${payment.currency} for ${reference} is due ${toDayKey(dueAt)}.`
      const created = await createDailyReminders(recipients.map((userId) => ({
        userId,
        organizationId: org.id,
        type: overdue ? 'PAYMENT_OVERDUE_REMINDER' : 'PAYMENT_DUE_SOON_REMINDER',
        title,
        message,
        entityType: 'Payment',
        entityId: payment.id,
        actionUrl: `/deals/${payment.dealId}`,
        // Package 33: flagged so the notification UI can label an overdue
        // installment explicitly without changing the historical type/code.
        metadata: { kind, dueDate: toDayKey(dueAt), reminderDay: todayKey, paymentStatus: payment.status, installmentAlert: true }
      })), todayKey)
      result.paymentReminders += created
    }

    // 2) Past-due appointments that are still SCHEDULED need an outcome logged.
    const appointments = await prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.SCHEDULED,
        startsAt: { lte: now },
        user: { organizationId: org.id, deletedAt: null, isActive: true, accountStatus: 'ACTIVE' }
      },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        userId: true
      },
      take: 500
    })

    for (const appt of appointments) {
      const end = appt.endsAt ?? new Date(appt.startsAt.getTime() + 60 * 60 * 1000)
      if (end.getTime() > now.getTime()) continue
      const created = await createDailyReminders([{
        userId: appt.userId,
        organizationId: org.id,
        type: 'APPOINTMENT_OUTCOME_REMINDER',
        title: 'Log appointment outcome',
        message: `${appt.title || 'Appointment'} ended and still needs an outcome/status update.`,
        entityType: 'Appointment',
        entityId: appt.id,
        actionUrl: '/appointments',
        metadata: { reminderDay: todayKey, endedAt: end.toISOString() }
      }], todayKey)
      result.appointmentReminders += created
    }

    // 2b) Package 33: upcoming appointments (<24h) still marked SCHEDULED.
    // createDailyReminders keys on reminderDay, so a 15-minute scheduler never
    // re-sends the same alert for the same appointment on the same day.
    const upcomingAppointments = await prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.SCHEDULED,
        startsAt: { gte: now, lt: appointmentSoonCutoff },
        user: { organizationId: org.id, deletedAt: null, isActive: true, accountStatus: 'ACTIVE' }
      },
      select: { id: true, title: true, startsAt: true, userId: true, lead: { select: { firstName: true, lastName: true } } },
      orderBy: { startsAt: 'asc' },
      take: 500
    })
    for (const appt of upcomingAppointments) {
      const recipients = await organizationRecipientIds(prisma, org.id, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: [appt.userId]
      })
      if (!recipients.length) continue
      const label = appt.title || (appt.lead
        ? `${appt.lead.firstName}${appt.lead.lastName ? ` ${appt.lead.lastName}` : ''}`
        : 'Appointment')
      const hours = Math.max(0, Math.round((appt.startsAt.getTime() - now.getTime()) / 3600000))
      const created = await createDailyReminders(recipients.map((userId) => ({
        userId,
        organizationId: org.id,
        type: 'APPOINTMENT_UPCOMING_24H',
        title: 'Appointment in less than 24 hours',
        message: `${label} starts at ${appt.startsAt.toISOString()} (in about ${hours} hour${hours === 1 ? '' : 's'}).`,
        entityType: 'Appointment',
        entityId: appt.id,
        actionUrl: `/appointments/${appt.id}`,
        metadata: { reminderDay: todayKey, kind: 'upcoming-24h', startsAt: appt.startsAt.toISOString() }
      })), todayKey)
      result.appointmentUpcomingReminders += created
    }

    // 3) Lead follow-ups due today or overdue. Open leads only; a won/lost
    // lead is no longer awaiting contact.
    const leads = await prisma.lead.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
        nextFollowUpAt: { not: null, lt: endOfToday },
        ...leadScope(org.id)
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        assignedToId: true,
        nextFollowUpAt: true
      },
      take: 500
    })

    for (const lead of leads) {
      if (!lead.nextFollowUpAt) continue
      const bucket = followUpBucket(lead.nextFollowUpAt, now)
      if (bucket !== 'overdue' && bucket !== 'today') continue
      const recipients = await organizationRecipientIds(prisma, org.id, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: [lead.assignedToId || '']
      })
      if (!recipients.length) continue
      const overdue = bucket === 'overdue'
      const dueDate = toDayKey(lead.nextFollowUpAt)
      const created = await createDailyReminders(recipients.map((userId) => ({
        userId,
        organizationId: org.id,
        type: overdue ? 'LEAD_FOLLOW_UP_OVERDUE_REMINDER' : 'LEAD_FOLLOW_UP_DUE_REMINDER',
        title: overdue ? 'Lead follow-up overdue' : 'Lead follow-up due today',
        message: `${leadLabel(lead)} needs a follow-up (${dueDate}${overdue ? ', overdue' : ''}).`,
        entityType: 'Lead',
        entityId: lead.id,
        actionUrl: `/leads?followUp=${bucket}`,
        metadata: { reminderDay: todayKey, kind: bucket, dueDate }
      })), todayKey)
      result.leadFollowUpReminders += created
    }

    // 3b) NEW leads with no contact at all for longer than the SLA window.
    // Deduplication is per lead/day so a retry never produces a second alert.
    const uncontactedCutoff = new Date(now.getTime() - UNCONTACTED_SLA_HOURS * 60 * 60 * 1000)
    const uncontacted = await prisma.lead.findMany({
      where: uncontactedLeadWhere(org.id, { now }),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        assignedToId: true,
        status: true,
        lastContactedAt: true,
        createdAt: true
      },
      orderBy: { createdAt: 'asc' },
      take: 500
    }).then((rows) => rows.filter((lead) =>
      lead.status === LeadStatus.NEW &&
      lead.lastContactedAt == null &&
      lead.createdAt.getTime() < uncontactedCutoff.getTime()
    ))
    for (const lead of uncontacted) {
      const recipients = await organizationRecipientIds(prisma, org.id, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: [lead.assignedToId || '']
      })
      if (!recipients.length) continue
      await createDailyReminders(recipients.map((userId) => ({
        userId,
        organizationId: org.id,
        type: 'NEW_LEAD_UNCONTACTED',
        title: 'New lead awaiting first contact',
        message: `${leadLabel(lead)} has not been contacted in over 24 hours.`,
        entityType: 'Lead',
        entityId: lead.id,
        actionUrl: '/leads',
        metadata: { reminderDay: todayKey, kind: 'uncontacted' }
      })), todayKey)
    }

    // 4) Rental leases expiring within their own notice window (or already
    // expired). Recipients are the responsible agent and local managers.
    const leases = await prisma.deal.findMany({
      where: {
        organizationId: org.id,
        deletedAt: null,
        isActive: true,
        type: DealType.RENT,
        status: { in: [DealStatus.PENDING, DealStatus.ACTIVE] },
        leaseEndAt: { not: null, lte: maxLeaseWindow }
      },
      select: {
        id: true,
        referenceNumber: true,
        userId: true,
        type: true,
        leaseEndAt: true,
        renewalNoticeDays: true,
        property: { select: { title: true } }
      },
      take: 500
    })

    for (const lease of leases) {
      if (!lease.leaseEndAt || !isLeaseRenewalDue(lease, now)) continue
      const recipients = await organizationRecipientIds(prisma, org.id, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: [lease.userId]
      })
      if (!recipients.length) continue
      const state = leaseRenewalState(lease, now)
      const expired = state === 'expired'
      const days = daysUntilLeaseEnd(lease.leaseEndAt, now)
      const dueDate = toDayKey(lease.leaseEndAt)
      const reference = lease.referenceNumber || lease.property?.title || 'a lease'
      const created = await createDailyReminders(recipients.map((userId) => ({
        userId,
        organizationId: org.id,
        type: expired ? 'LEASE_EXPIRED_REMINDER' : 'LEASE_RENEWAL_REMINDER',
        title: expired ? 'Lease expired' : 'Lease renewal due',
        message: `${reference} ${expired ? `expired on ${dueDate}` : `expires on ${dueDate} (${days} day${days === 1 ? '' : 's'} left)`}.`,
        entityType: 'Deal',
        entityId: lease.id,
        actionUrl: `/deals/${lease.id}`,
        metadata: { reminderDay: todayKey, kind: state, daysUntil: days, leaseEnd: dueDate }
      })), todayKey)
      result.leaseRenewalReminders += created
    }

    // 5) Recurring maintenance cycles that are due or overdue. Dedupe is per
    // request/day, so a scheduler retry never produces a second reminder.
    const recurring = await prisma.maintenanceRequest.findMany({
      where: {
        organizationId: org.id,
        deletedAt: null,
        status: { in: [MaintenanceStatus.OPEN, MaintenanceStatus.IN_PROGRESS] },
        recurrenceInterval: { not: MaintenanceRecurrenceInterval.NONE },
        OR: [
          { nextDueAt: { not: null, lte: endOfToday } },
          { nextDueAt: null, dueAt: { not: null, lte: endOfToday } }
        ]
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        nextDueAt: true,
        assignedToId: true,
        recurrenceInterval: true
      },
      take: 500
    })

    for (const request of recurring) {
      const dueAt = request.nextDueAt ?? request.dueAt
      if (!dueAt) continue
      const overdue = isOverdue(dueAt, now)
      if (!overdue && dueAt.getTime() >= endOfToday.getTime()) continue
      const recipients = await organizationRecipientIds(prisma, org.id, {
        roles: ['ADMIN', 'MANAGER'],
        includeUserIds: request.assignedToId ? [request.assignedToId] : []
      })
      if (!recipients.length) continue
      const dueDate = toDayKey(dueAt)
      const created = await createDailyReminders(recipients.map((userId) => ({
        userId,
        organizationId: org.id,
        type: overdue ? 'MAINTENANCE_RECURRING_OVERDUE_REMINDER' : 'MAINTENANCE_RECURRING_DUE_REMINDER',
        title: overdue ? 'Recurring maintenance overdue' : 'Recurring maintenance due',
        message: `${request.title || 'Maintenance'} (${request.recurrenceInterval.toLowerCase()}) is ${overdue ? 'overdue' : 'due'} on ${dueDate}.`,
        entityType: 'MaintenanceRequest',
        entityId: request.id,
        actionUrl: `/maintenance/${request.id}`,
        metadata: { reminderDay: todayKey, kind: overdue ? 'overdue' : 'due', dueDate }
      })), todayKey)
      result.maintenanceReminders += created
    }
  }

  return result
}

let intervalHandle: ReturnType<typeof setInterval> | null = null
let startupHandle: ReturnType<typeof setTimeout> | null = null
let running = false

async function runSafely(label: string) {
  if (running) return
  running = true
  try {
    const res = await runReminders(new Date())
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[reminders] ${label}: orgs=${res.organizations} payment=${res.paymentReminders} appointment=${res.appointmentReminders} upcoming=${res.appointmentUpcomingReminders} followUp=${res.leadFollowUpReminders} lease=${res.leaseRenewalReminders} maintenance=${res.maintenanceReminders}`)
    }
  } catch (err) {
    console.error(`[reminders] ${label} failed`, err)
  } finally {
    running = false
  }
}

export function startReminderScheduler(): void {
  if (process.env.DISABLE_REMINDERS === 'true' || process.env.NODE_ENV === 'test') return
  if (intervalHandle || startupHandle) return
  const intervalMs = Number(process.env.REMINDER_INTERVAL_MS || DEFAULT_INTERVAL_MS)
  const safeInterval = Number.isFinite(intervalMs) && intervalMs >= 60_000 ? intervalMs : DEFAULT_INTERVAL_MS
  startupHandle = setTimeout(() => {
    startupHandle = null
    void runSafely('startup')
  }, 5_000)
  intervalHandle = setInterval(() => { void runSafely('interval') }, safeInterval)
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref()
}

export function stopReminderScheduler(): void {
  if (startupHandle) { clearTimeout(startupHandle); startupHandle = null }
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null }
}
