/** Shared helpers for revocable public property share links. */

export function isValidShareToken(token: string): boolean {
  return token.length >= 16 && /^[A-Za-z0-9_-]+$/.test(token)
}

export function isShareExpired(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime())
}

export function publicSharePath(token: string): string {
  return `/p/${encodeURIComponent(token)}`
}

export function buildPublicShareUrl(token: string, options: { publicAppUrl?: string; origin?: string } = {}): string {
  const path = publicSharePath(token)
  const base = options.publicAppUrl?.replace(/\/$/, '')
  if (base) return `${base}${path}`
  const origin = options.origin?.replace(/\/$/, '')
  if (origin) return `${origin}${path}`
  return path
}

/** Package 28: the matching read-only owner portal helpers. */
export function ownerPortalPath(token: string): string {
  return `/owner-portal/${encodeURIComponent(token)}`
}

export function buildOwnerPortalUrl(token: string, options: { publicAppUrl?: string; origin?: string } = {}): string {
  const path = ownerPortalPath(token)
  const base = options.publicAppUrl?.replace(/\/$/, '')
  if (base) return `${base}${path}`
  const origin = options.origin?.replace(/\/$/, '')
  if (origin) return `${origin}${path}`
  return path
}
