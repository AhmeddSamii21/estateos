export interface RateLimitCheck {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
  resetAt: number
}

export interface InMemoryLimiter {
  check(key: string, now?: number): RateLimitCheck
  reset(): void
  size(): number
  max: number
  windowMs: number
}

/**
 * Fixed-window limiter kept entirely in process memory. It is intentionally
 * simple: a clean 429 is preferable to leaking internals or blocking unrelated
 * tenants. Multi-instance deployments should replace it with shared storage.
 */
export function createInMemoryLimiter(options: { windowMs: number; max: number }): InMemoryLimiter {
  const windowMs = Number.isFinite(options.windowMs) && options.windowMs > 0 ? options.windowMs : 900000
  const max = Number.isFinite(options.max) && options.max > 0 ? Math.floor(options.max) : 100
  const buckets = new Map<string, { resetAt: number; count: number }>()

  return {
    max,
    windowMs,
    check(key: string, now = Date.now()): RateLimitCheck {
      const bucket = buckets.get(key)
      if (!bucket || now >= bucket.resetAt) {
        const resetAt = now + windowMs
        buckets.set(key, { resetAt, count: 1 })
        return { allowed: true, remaining: max - 1, retryAfterSeconds: 0, resetAt }
      }
      if (bucket.count >= max) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
          resetAt: bucket.resetAt
        }
      }
      bucket.count += 1
      return { allowed: true, remaining: max - bucket.count, retryAfterSeconds: 0, resetAt: bucket.resetAt }
    },
    reset(): void {
      buckets.clear()
    },
    size(): number {
      return buckets.size
    }
  }
}

export function rateLimitKey(ip: string | undefined, path: string): string {
  const normalizedIp = (ip || 'unknown').replace(/[^A-Za-z0-9.:_-]/g, '').slice(0, 64) || 'unknown'
  return `${normalizedIp}|${path}`
}

export function loginRateLimitKey(ip: string | undefined): string {
  return rateLimitKey(ip, 'auth')
}

export function registerRateLimitKey(ip: string | undefined): string {
  return rateLimitKey(ip, 'register')
}

export function publicRateLimitKey(ip: string | undefined): string {
  return rateLimitKey(ip, 'public')
}
