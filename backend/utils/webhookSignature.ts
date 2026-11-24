import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Package 22: webhook signing keys are derived from the stored secret hash and
 * a server-side pepper so a database leak alone cannot forge signatures. The
 * raw secret is shown once when the endpoint is created; only its SHA-256 hash
 * is persisted.
 */
const SECRET_PREFIX = 'whsec_'

export interface GeneratedWebhookSecret {
  secret: string
  secretHash: string
}

export function generateWebhookSecret(): GeneratedWebhookSecret {
  const secret = `${SECRET_PREFIX}${randomBytes(32).toString('hex')}`
  return { secret, secretHash: hashWebhookSecret(secret) }
}

export function hashWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function signingKeyOf(secretHash: string): Buffer {
  const pepper = process.env.WEBHOOK_SIGNING_KEY || process.env.JWT_SECRET || 'estateos-webhook-development-key'
  return createHmac('sha256', pepper).update(secretHash).digest()
}

export function signWebhookPayload(payload: string, secretHash: string): string {
  return createHmac('sha256', signingKeyOf(secretHash)).update(payload, 'utf8').digest('hex')
}

export function signatureHeader(signature: string): string {
  return `sha256=${signature}`
}

/** Constant-time comparison used by receivers and tests. */
export function verifyWebhookSignature(payload: string, secretHash: string, header: string): boolean {
  const expected = Buffer.from(signatureHeader(signWebhookPayload(payload, secretHash)))
  const actual = Buffer.from(header)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
