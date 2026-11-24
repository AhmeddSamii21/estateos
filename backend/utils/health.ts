export type HealthStatus = 'OK' | 'DEGRADED'

export interface HealthInput {
  dbOk: boolean
  startedAt: Date
  now?: Date
  dbLatencyMs?: number | null
  dbError?: string | null
}

export interface HealthPayload {
  status: HealthStatus
  timestamp: string
  uptimeSeconds: number
  uptime: string
  checks: {
    database: {
      status: 'up' | 'down'
      latencyMs: number | null
    }
  }
}

function uptimeString(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  return `${days}d ${hours}h ${minutes}m ${secs}s`
}

/** Never include connection strings, env values, stack traces or user data. */
export function buildHealthPayload(input: HealthInput): HealthPayload {
  const now = input.now || new Date()
  const uptimeSeconds = Math.max(0, Math.floor((now.getTime() - input.startedAt.getTime()) / 1000))
  return {
    status: input.dbOk ? 'OK' : 'DEGRADED',
    timestamp: now.toISOString(),
    uptimeSeconds,
    uptime: uptimeString(uptimeSeconds),
    checks: {
      database: {
        status: input.dbOk ? 'up' : 'down',
        latencyMs: input.dbOk && Number.isFinite(input.dbLatencyMs ?? NaN) ? Math.max(0, Math.round(input.dbLatencyMs as number)) : null
      }
    }
  }
}

export async function probeDatabase(client: { $queryRawUnsafe: (query: string) => Promise<unknown> }): Promise<{ ok: boolean; latencyMs: number | null; error: string | null }> {
  const started = Date.now()
  try {
    await client.$queryRawUnsafe('SELECT 1')
    return { ok: true, latencyMs: Date.now() - started, error: null }
  } catch (error) {
    // Only a stable category is exposed; raw driver messages can contain URLs.
    const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : 'DatabaseError'
    return { ok: false, latencyMs: null, error: name }
  }
}
