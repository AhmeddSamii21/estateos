export interface BoundedQueryOptions {
  take?: unknown
  first?: unknown
}

/** Backend list queries must declare a finite `take`; unbounded reads are rejected. */
export function isBounded(options: BoundedQueryOptions | null | undefined, maxTake = 100): boolean {
  if (!options) return false
  if (options.first !== undefined && options.first !== null) return true
  const take = options.take
  if (typeof take !== 'number' || !Number.isFinite(take)) return false
  return take > 0 && take <= maxTake
}

export interface UnboundedCall {
  file: string
  index: number
  snippet: string
}

/**
 * Heuristic audit for `findMany` calls in compiled route files. Each call must
 * mention `take:` in its argument object; `count`/`groupBy` are not list reads.
 */
export function auditUnboundedFindMany(sources: Record<string, string>): UnboundedCall[] {
  const findings: UnboundedCall[] = []
  for (const [file, source] of Object.entries(sources)) {
    const pattern = /\.findMany\s*\(/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      const window = source.slice(match.index, match.index + 500)
      if (!/\btake\s*:/.test(window)) {
        findings.push({ file, index: match.index, snippet: window.slice(0, 120).replace(/\s+/g, ' ') })
      }
    }
  }
  return findings
}
