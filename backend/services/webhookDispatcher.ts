import axios from 'axios'
import { Prisma, WebhookDeliveryStatus, type WebhookDelivery, type WebhookEndpoint } from '@prisma/client'
import { prisma } from '../prisma'
import { isWebhookEventCode } from '../utils/webhookEvents'
import {
  buildWebhookEnvelope,
  sanitizeWebhookData,
  webhookEventKey,
  type WebhookDispatchInput,
  type WebhookEnvelope
} from '../utils/webhookPayload'
import { signWebhookPayload, signatureHeader } from '../utils/webhookSignature'
import { validateWebhookUrl } from '../utils/webhookUrl'

/**
 * Package 22: never-attaching outbound dispatcher. Every entry point catches
 * all errors so a webhook endpoint can never change the status or JSON of the
 * core property/lead/deal/payment API call that triggered it.
 */
type EndpointContext = Pick<WebhookEndpoint, 'id' | 'organizationId' | 'url' | 'secretHash'>

const MAX_RESPONSE_BODY = 2000
const MAX_ERROR_LENGTH = 500
const configuredTimeout = Number(process.env.WEBHOOK_TIMEOUT_MS || 5000)
const TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout >= 500 && configuredTimeout <= 30_000
  ? configuredTimeout
  : 5000

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error'
  return message.slice(0, MAX_ERROR_LENGTH)
}

function report(error: unknown, context: string): void {
  console.error(`[webhooks] ${context}:`, messageOf(error))
}

function envelopeFromStored(value: Prisma.JsonValue): WebhookEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (!isWebhookEventCode(candidate.event)) return null
  if (typeof candidate.createdAt !== 'string' || typeof candidate.organizationId !== 'string') return null
  if (!candidate.data || typeof candidate.data !== 'object' || Array.isArray(candidate.data)) return null
  return {
    event: candidate.event,
    createdAt: candidate.createdAt,
    organizationId: candidate.organizationId,
    data: sanitizeWebhookData(candidate.data as Record<string, unknown>)
  }
}

async function createDelivery(
  endpoint: EndpointContext,
  input: WebhookDispatchInput,
  envelope: WebhookEnvelope,
  eventKey: string
): Promise<string | null> {
  try {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        organizationId: endpoint.organizationId,
        endpointId: endpoint.id,
        event: input.event,
        eventKey,
        status: WebhookDeliveryStatus.PENDING,
        attempt: 1,
        requestUrl: endpoint.url,
        payload: envelope as unknown as Prisma.InputJsonValue
      },
      select: { id: true }
    })
    return delivery.id
  } catch (error) {
    // The unique (organization, endpoint, eventKey) index means an identical
    // event was already recorded for this endpoint; never surface that to the
    // triggering business request.
    report(error, 'delivery record could not be created')
    return null
  }
}

async function attemptDelivery(
  deliveryId: string,
  endpoint: EndpointContext,
  envelope: WebhookEnvelope,
  attempt: number
): Promise<void> {
  let status: WebhookDeliveryStatus = WebhookDeliveryStatus.FAILED
  let responseStatus: number | null = null
  let responseBody: string | null = null
  let errorMessage: string | null = null
  let deliveredAt: Date | null = null

  try {
    // Re-validate at send time: configuration may have changed since the
    // endpoint was created and DNS rebinding must not bypass the SSRF guard.
    const requestUrl = await validateWebhookUrl(endpoint.url)
    const body = JSON.stringify(envelope)
    const signature = signWebhookPayload(body, endpoint.secretHash)
    const response = await axios.post(requestUrl, body, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'EstateOS-Webhooks/1.0',
        'X-Webhook-Event': envelope.event,
        'X-Webhook-Delivery': deliveryId,
        'X-Webhook-Attempt': String(attempt),
        'X-Webhook-Signature': signatureHeader(signature)
      },
      timeout: TIMEOUT_MS,
      maxRedirects: 0,
      maxBodyLength: 1024 * 1024,
      maxContentLength: 1024 * 1024,
      responseType: 'text',
      validateStatus: () => true
    })
    responseStatus = response.status
    responseBody = String(response.data ?? '').slice(0, MAX_RESPONSE_BODY)
    if (response.status >= 200 && response.status < 300) {
      status = WebhookDeliveryStatus.SUCCESS
      deliveredAt = new Date()
    } else {
      errorMessage = `Receiver responded with HTTP ${response.status}`.slice(0, MAX_ERROR_LENGTH)
    }
  } catch (error) {
    errorMessage = messageOf(error)
  }

  try {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status,
        attempt,
        responseStatus,
        responseBody,
        error: errorMessage,
        deliveredAt,
        nextRetryAt: null,
        updatedAt: new Date()
      }
    })
  } catch (error) {
    report(error, 'delivery result could not be persisted')
  }
}

/** Fire at every active endpoint subscribed to the event. Safe to await. */
export async function dispatchWebhookEvent(input: WebhookDispatchInput): Promise<void> {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: {
        organizationId: input.organizationId,
        isActive: true,
        deletedAt: null,
        events: { has: input.event }
      },
      select: { id: true, organizationId: true, url: true, secretHash: true }
    })
    if (!endpoints.length) return
    const envelope = buildWebhookEnvelope(input)
    const eventKey = webhookEventKey(input)
    for (const endpoint of endpoints) {
      const deliveryId = await createDelivery(endpoint, input, envelope, eventKey)
      if (deliveryId) await attemptDelivery(deliveryId, endpoint, envelope, 1)
    }
  } catch (error) {
    report(error, 'event dispatch failed')
  }
}

/** Reuses the exact same validation/signing path as the initial dispatch. */
export async function retryWebhookDelivery(
  deliveryId: string,
  organizationId: string
): Promise<WebhookDelivery | null> {
  try {
    const delivery = await prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, organizationId },
      include: { endpoint: true }
    })
    if (!delivery) return null
    const envelope = envelopeFromStored(delivery.payload)
    if (!envelope) {
      report(new Error('stored payload is not a webhook envelope'), 'retry rejected')
      return null
    }
    const attempt = delivery.attempt + 1
    const endpoint: EndpointContext = {
      id: delivery.endpoint.id,
      organizationId: delivery.endpoint.organizationId,
      url: delivery.endpoint.url,
      secretHash: delivery.endpoint.secretHash
    }
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.RETRYING,
        attempt,
        responseStatus: null,
        responseBody: null,
        error: null,
        deliveredAt: null,
        nextRetryAt: null
      }
    })
    await attemptDelivery(deliveryId, endpoint, envelope, attempt)
    return await prisma.webhookDelivery.findFirst({ where: { id: deliveryId, organizationId } })
  } catch (error) {
    report(error, 'retry failed')
    return null
  }
}
