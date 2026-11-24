import { AccountStatus, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { resolveNotificationTarget } from '../utils/notificationTargets'

export type NotificationClient = Prisma.TransactionClient | typeof prisma

export interface NotificationInput {
  userId: string
  organizationId?: string | null
  type: string
  title: string
  message: string
  entityType?: string | null
  entityId?: string | null
  actionUrl?: string | null
  metadata?: Record<string, unknown> | null
}

type NotificationKeyInput = Omit<NotificationInput, 'metadata'> & { metadata?: unknown }

function keyOf(input: NotificationKeyInput): string {
  return [
    input.userId,
    input.organizationId || '',
    input.type,
    input.entityType || '',
    input.entityId || '',
    input.title,
    input.message,
    input.actionUrl || '',
    JSON.stringify(input.metadata ?? null)
  ].join('|')
}

const configuredWindow = Number(process.env.NOTIFICATION_DEDUPE_WINDOW_MS ?? 5 * 60 * 1000)
const DEDUPE_WINDOW_MS = Number.isFinite(configuredWindow) && configuredWindow >= 0
  ? configuredWindow
  : 5 * 60 * 1000

export async function createNotifications(
  client: NotificationClient,
  inputs: NotificationInput[]
): Promise<number> {
  if (!inputs.length) return 0
  // Every stored actionUrl passes through the frontend allowlist before
  // dedupe, so no caller can persist an arbitrary or unsafe navigation target.
  const safeInputs: NotificationInput[] = inputs.map((input) => ({
    ...input,
    actionUrl: resolveNotificationTarget({
      actionUrl: input.actionUrl,
      entityType: input.entityType,
      entityId: input.entityId
    })
  }))
  const deduped = new Map<string, NotificationInput>()
  for (const input of safeInputs) {
    if (!input.userId) continue
    deduped.set(keyOf(input), input)
  }
  const candidates = Array.from(deduped.entries())
  if (!candidates.length) return 0

  // Deduplicate across requests too: retries and repeated stage notifications
  // must not send the same event twice. The window keeps unrelated future
  // events with an identical payload deliverable.
  const conditions = candidates.map(([, input]) => ({
    AND: [
      { userId: input.userId },
      { organizationId: input.organizationId || null },
      { type: input.type },
      { entityType: input.entityType || null },
      { entityId: input.entityId || null },
      { title: input.title },
      { message: input.message },
      { actionUrl: input.actionUrl || null }
    ]
  }))
  const existing = await client.notification.findMany({
    where: {
      OR: conditions,
      createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) }
    },
    take: 1000,
    select: {
      userId: true,
      organizationId: true,
      type: true,
      title: true,
      message: true,
      entityType: true,
      entityId: true,
      actionUrl: true,
      metadata: true
    }
  })
  const seen = new Set(existing.map((row) => keyOf(row)))
  const data = candidates
    .filter(([key]) => !seen.has(key))
    .map(([, input]) => ({
      userId: input.userId,
      organizationId: input.organizationId || null,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType || null,
      entityId: input.entityId || null,
      actionUrl: input.actionUrl || null,
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined
    }))
  if (!data.length) return 0
  await client.notification.createMany({ data })
  return data.length
}

export async function notifyUsers(
  client: NotificationClient,
  userIds: string[],
  base: Omit<NotificationInput, 'userId'>
): Promise<number> {
  const unique = Array.from(new Set(userIds.filter(Boolean)))
  if (!unique.length) return 0
  return createNotifications(client, unique.map((userId) => ({ ...base, userId })))
}

export async function organizationRecipientIds(
  client: NotificationClient,
  organizationId: string,
  options: { roles?: string[]; excludeUserId?: string | null; includeUserIds?: string[] } = {}
): Promise<string[]> {
  const ids = new Set<string>((options.includeUserIds || []).filter(Boolean))
  if (options.roles?.length) {
    const users = await client.user.findMany({
      where: {
        organizationId,
        deletedAt: null,
        isActive: true,
        accountStatus: AccountStatus.ACTIVE,
        role: { in: options.roles as never }
      },
      take: 1000,
      select: { id: true }
    })
    for (const user of users) ids.add(user.id)
  }
  if (options.excludeUserId) ids.delete(options.excludeUserId)
  return Array.from(ids)
}
