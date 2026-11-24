/**
 * Package 22: the only event codes that may be configured or emitted by the
 * outbound webhook subsystem. Keeping this list here lets route validation,
 * the dispatcher and the frontend share one contract.
 */
export const WEBHOOK_EVENT_CODES = [
  'property.created',
  'lead.created',
  'deal.stage_changed',
  'payment.recorded'
] as const

export type WebhookEventCode = (typeof WEBHOOK_EVENT_CODES)[number]

export const WEBHOOK_EVENT_ENTITY: Record<WebhookEventCode, string> = {
  'property.created': 'Property',
  'lead.created': 'Lead',
  'deal.stage_changed': 'Deal',
  'payment.recorded': 'Payment'
}

export function isWebhookEventCode(value: unknown): value is WebhookEventCode {
  return typeof value === 'string' && (WEBHOOK_EVENT_CODES as readonly string[]).includes(value)
}

/** Parses a request body event list without accepting unknown aliases. */
export function parseWebhookEvents(value: unknown): WebhookEventCode[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('events must be a non-empty array of supported event codes')
  }
  const events: WebhookEventCode[] = []
  for (const candidate of value) {
    if (!isWebhookEventCode(candidate)) {
      throw new Error(`Unsupported webhook event: ${String(candidate)}`)
    }
    if (!events.includes(candidate)) events.push(candidate)
  }
  return events
}
