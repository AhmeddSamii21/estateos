import { createHash } from 'node:crypto'
import type { WebhookEventCode } from './webhookEvents'

/**
 * Package 22: dispatch inputs are explicit allowlists at the call site. This
 * sanitizer is a second line of defence so no full Prisma row, password,
 * token or secret can leak into a stored/sent webhook payload.
 */
export interface WebhookDispatchInput {
  organizationId: string
  event: WebhookEventCode
  entityId: string
  data: Record<string, unknown>
  actorUserId?: string | null
}

export interface WebhookEnvelope {
  event: WebhookEventCode
  createdAt: string
  organizationId: string
  data: Record<string, unknown>
}

const BLOCKED_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'credential',
  'cookie',
  'sessionid'
]

function blockedKey(key: string): boolean {
  const lower = key.toLowerCase()
  return BLOCKED_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment))
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null) return null
  if (depth > 6) return '[truncated]'
  if (typeof value === 'string') return value.slice(0, 1000)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1))
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(source)) {
      if (blockedKey(key) || key.length > 100) continue
      output[key.slice(0, 100)] = sanitizeValue(item, depth + 1)
    }
    return output
  }
  return null
}

export function sanitizeWebhookData(data: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(data, 0) as Record<string, unknown>
}

export function buildWebhookEnvelope(input: WebhookDispatchInput, createdAt = new Date()): WebhookEnvelope {
  return {
    event: input.event,
    createdAt: createdAt.toISOString(),
    organizationId: input.organizationId,
    data: sanitizeWebhookData({
      entityId: input.entityId,
      actorUserId: input.actorUserId ?? null,
      ...input.data
    })
  }
}

/** Stable idempotency key: identical entity/event data never double-delivers. */
export function webhookEventKey(input: WebhookDispatchInput): string {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      organizationId: input.organizationId,
      event: input.event,
      entityId: input.entityId,
      data: sanitizeWebhookData(input.data)
    }))
    .digest('hex')
    .slice(0, 32)
  return `${input.event}:${input.entityId}:${fingerprint}`
}
