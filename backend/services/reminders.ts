import { AppointmentStatus, PaymentStatus } from '@prisma/client'
import { prisma } from '../prisma'
import { createNotifications, organizationRecipientIds, type NotificationInput } from './notifications'

const DEFAULT_DUE_SOON_HOURS = 48
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000

export function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function isOverdue(dueAt: Date, now: Date): boolean {
  return dueAt.getTime() < new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime()
}

export interface ReminderRunResult {
  organizations: number
  paymentReminders: number
  appointmentReminders: number
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
  const todayKey = toDayKey(now)
  const result: ReminderRunResult = { organizations: 0, paymentReminders: 0, appointmentReminders: 0 }

  const organizations = await prisma.organization.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ...(options.organizationIds ? { id: { in: options.organizationIds } } : {})
    },
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
      select: {
        id: true,
        dealId: true,
        amount: true,
        currency: true,
        status: true,
        paidAt: true,
        deal: { select: { id: true, referenceNumber: true, userId: true, organizationId: true, dueAt: true } }
      },
      take: 500
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
        metadata: { kind, dueDate: toDayKey(dueAt), reminderDay: todayKey, paymentStatus: payment.status }
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
      console.log(`[reminders] ${label}: orgs=${res.organizations} payment=${res.paymentReminders} appointment=${res.appointmentReminders}`)
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
