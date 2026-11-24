/** Package 31: shared helpers for revocable lead/deal client portal links. */

import { randomBytes } from 'node:crypto'
import type { Request } from 'express'
import { buildClientPortalUrl, isValidShareToken } from './share'

export type ClientPortalKind = 'LEAD' | 'DEAL'

export interface ClientPortalRecord {
  portalToken: string | null
  portalEnabled: boolean
}

/** Strip the bearer capability from any management-facing Lead/Deal payload. */
export function withoutPortalToken<T extends { portalToken?: string | null }>(record: T): Omit<T, 'portalToken'> {
  const { portalToken, ...rest } = record
  void portalToken
  return rest
}

const TOKEN_PREFIXES: Record<ClientPortalKind, string> = {
  LEAD: 'lead_',
  DEAL: 'deal_'
}

/**
 * Prefixing keeps lead and deal tokens disjoint even though both live in the
 * same public endpoint. The random suffix stays URL-safe and unguessable.
 */
export function newClientPortalToken(kind: ClientPortalKind): string {
  return `${TOKEN_PREFIXES[kind]}${randomBytes(24).toString('base64url')}`
}

export function clientPortalKind(token: string): ClientPortalKind | null {
  if (token.startsWith(TOKEN_PREFIXES.LEAD)) return 'LEAD'
  if (token.startsWith(TOKEN_PREFIXES.DEAL)) return 'DEAL'
  return null
}

export function clientPortalUrl(token: string, req: Request): string {
  return buildClientPortalUrl(token, {
    publicAppUrl: process.env.PUBLIC_APP_URL,
    origin: req.get('origin')
  })
}

/** Management responses receive the state and URL, never a raw stored token. */
export function clientPortalLink(record: ClientPortalRecord, req: Request) {
  const active = Boolean(record.portalEnabled && record.portalToken && isValidShareToken(record.portalToken))
  return {
    enabled: active,
    token: active ? record.portalToken : null,
    url: active && record.portalToken ? clientPortalUrl(record.portalToken, req) : null
  }
}
