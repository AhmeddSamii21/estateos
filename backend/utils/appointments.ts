import { AppointmentStatus, type Prisma } from '@prisma/client'
import type { AuditClient } from './audit'
import { failValidation } from './validation'

/** Appointments without an explicit end are treated as one-hour windows for conflict checks. */
export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60

export type ConflictReason = 'user' | 'property'

export interface AppointmentConflict {
  id: string
  title: string | null
  startsAt: string
  endsAt: string | null
  status: string
  userId: string
  propertyId: string | null
  reasons: ConflictReason[]
}

export interface AppointmentConflictWarning {
  code: 'APPOINTMENT_CONFLICT'
  message: string
  conflicts: AppointmentConflict[]
}

export interface AppointmentQueryClient {
  appointment: {
    findMany(args: Prisma.AppointmentFindManyArgs): Promise<Array<{
      id: string
      title: string | null
      startsAt: Date
      endsAt: Date | null
      status: AppointmentStatus
      userId: string
      propertyId: string | null
    }>>
  }
}

/**
 * Organization scope for appointments. The organizer must be local, and every
 * optional linked record must also resolve locally; a local property or lead
 * alone must not expose another organization's appointment.
 */
export function appointmentScope(organizationId: string): Prisma.AppointmentWhereInput {
  return {
    AND: [
      { user: { organizationId } },
      { OR: [{ propertyId: null }, { property: { organizationId } }] },
      {
        OR: [
          { leadId: null },
          {
            lead: {
              AND: [
                { OR: [{ property: { organizationId } }, { assignedTo: { organizationId } }] },
                { OR: [{ propertyId: null }, { property: { organizationId } }] },
                { OR: [{ assignedToId: null }, { assignedTo: { organizationId } }] }
              ]
            }
          }
        ]
      }
    ]
  }
}

export function appointmentWindow(startsAt: Date, endsAt: Date | null | undefined): { start: Date; end: Date } {
  const end = endsAt && !Number.isNaN(endsAt.getTime())
    ? endsAt
    : new Date(startsAt.getTime() + DEFAULT_APPOINTMENT_DURATION_MINUTES * 60 * 1000)
  return { start: startsAt, end }
}

export function assertValidAppointmentWindow(startsAt: Date, endsAt: Date | null | undefined): void {
  if (endsAt && endsAt <= startsAt) {
    failValidation('endsAt', 'endsAt must be after startsAt')
  }
}

/**
 * Finds overlapping appointments in the same organization on the same assigned user
 * or the same property. Cancelled no-shows do not block a time slot.
 * Conflicts are advisory: callers return them as warnings, not hard errors.
 */
export async function findAppointmentConflicts(
  client: AppointmentQueryClient | AuditClient,
  params: {
    organizationId: string
    startsAt: Date
    endsAt: Date | null | undefined
    userId?: string
    propertyId?: string | null
    excludeId?: string
  }
): Promise<AppointmentConflict[]> {
  const reasonsToMatch: Array<Record<string, unknown>> = []
  if (params.userId) reasonsToMatch.push({ userId: params.userId })
  if (params.propertyId) reasonsToMatch.push({ propertyId: params.propertyId })
  if (!reasonsToMatch.length) return []

  const { start, end } = appointmentWindow(params.startsAt, params.endsAt)
  const where: Prisma.AppointmentWhereInput = {
    AND: [
      appointmentScope(params.organizationId),
      {
        status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
        startsAt: { lte: end },
        AND: [
          { OR: [{ endsAt: null }, { endsAt: { gte: start } }] },
          { OR: reasonsToMatch as Prisma.AppointmentWhereInput[] },
          ...(params.excludeId ? [{ id: { not: params.excludeId } }] : [])
        ]
      }
    ]
  }

  const candidates = await client.appointment.findMany({
    where,
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      userId: true,
      propertyId: true
    },
    orderBy: { startsAt: 'asc' },
    take: 50
  })

  return candidates.flatMap((candidate) => {
    // The query already applies these rules; repeat them here so callers with a
    // partial/mocked data source can never surface stale or self conflicts.
    if (candidate.status === AppointmentStatus.CANCELLED || candidate.status === AppointmentStatus.NO_SHOW) return []
    if (params.excludeId && candidate.id === params.excludeId) return []
    const window = appointmentWindow(candidate.startsAt, candidate.endsAt)
    if (window.start >= end || window.end <= start) return []
    const reasons: ConflictReason[] = []
    if (params.userId && candidate.userId === params.userId) reasons.push('user')
    if (params.propertyId && candidate.propertyId === params.propertyId) reasons.push('property')
    if (!reasons.length) return []
    return [{
      id: candidate.id,
      title: candidate.title,
      startsAt: candidate.startsAt.toISOString(),
      endsAt: candidate.endsAt ? candidate.endsAt.toISOString() : null,
      status: candidate.status,
      userId: candidate.userId,
      propertyId: candidate.propertyId,
      reasons
    }]
  })
}

export function appointmentConflictWarnings(conflicts: AppointmentConflict[]): AppointmentConflictWarning[] {
  if (!conflicts.length) return []
  return [{
    code: 'APPOINTMENT_CONFLICT',
    message: `${conflicts.length} overlapping appointment${conflicts.length === 1 ? '' : 's'} found. The appointment was saved; review the conflicts below.`,
    conflicts
  }]
}
