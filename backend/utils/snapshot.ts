export const SNAPSHOT_MODELS = [
  'properties',
  'owners',
  'leads',
  'deals',
  'appointments',
  'payments',
  'expenses',
  'commissions',
  'settings'
] as const
export type SnapshotModel = typeof SNAPSHOT_MODELS[number]

const FORBIDDEN_KEYS = new Set(['password', 'token', 'tokenVersion', 'secret', 'jwt', 'jwtSecret', 'apiKey', 'accessToken', 'refreshToken'])

export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase())
}

/** Recursive allow-nothing-secret sanitizer used for every exported row. */
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item)) as T
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenKey(key)) continue
      output[key] = stripSecrets(child)
    }
    return output as T
  }
  return value
}

export interface SnapshotInput {
  organizationId: string
  organization?: Record<string, unknown> | null
  properties?: unknown[]
  owners?: unknown[]
  leads?: unknown[]
  deals?: unknown[]
  appointments?: unknown[]
  payments?: unknown[]
  expenses?: unknown[]
  commissions?: unknown[]
  settings?: unknown[]
  now?: Date
}

export function buildSnapshot(input: SnapshotInput): Record<string, unknown> {
  const now = input.now || new Date()
  const data: Record<string, unknown[]> = {}
  for (const model of SNAPSHOT_MODELS) {
    data[model] = stripSecrets((input[model] as unknown[]) || [])
  }
  const counts: Record<string, number> = {}
  for (const model of SNAPSHOT_MODELS) counts[model] = data[model].length

  return stripSecrets({
    version: 1,
    generatedAt: now.toISOString(),
    organizationId: input.organizationId,
    organization: input.organization || null,
    counts,
    data
  })
}

export function snapshotFilename(organizationId: string, now = new Date()): string {
  const safeId = organizationId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'tenant'
  return `estateos-snapshot-${safeId}-${now.toISOString().slice(0, 10)}.json`
}
