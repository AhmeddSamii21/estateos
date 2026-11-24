const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

process.env.NODE_ENV = 'test'

const rateLimit = require('../dist-backend/utils/inMemoryRateLimit.js')
const health = require('../dist-backend/utils/health.js')
const snapshot = require('../dist-backend/utils/snapshot.js')
const queryAudit = require('../dist-backend/utils/queryAudit.js')

// ---------------------------------------------------------------------------
// Part 1 — in-memory rate limiting and security/tracing headers
// ---------------------------------------------------------------------------

test('Part 1: limiter allows up to max then returns a clean retry window', () => {
  const limiter = rateLimit.createInMemoryLimiter({ windowMs: 1000, max: 2 })
  const now = 10000
  assert.deepEqual(limiter.check('ip|auth', now), { allowed: true, remaining: 1, retryAfterSeconds: 0, resetAt: 11000 })
  assert.deepEqual(limiter.check('ip|auth', now), { allowed: true, remaining: 0, retryAfterSeconds: 0, resetAt: 11000 })
  const blocked = limiter.check('ip|auth', now + 100)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.remaining, 0)
  assert.equal(blocked.retryAfterSeconds, 1)
  assert.equal(limiter.check('other|auth', now).allowed, true)
  assert.equal(limiter.check('ip|auth', now + 1000).allowed, true)
  limiter.reset()
  assert.equal(limiter.size(), 0)
})

test('Part 1: rate limit keys are sanitized and endpoint-specific', () => {
  assert.equal(rateLimit.loginRateLimitKey('127.0.0.1'), '127.0.0.1|auth')
  assert.equal(rateLimit.registerRateLimitKey('127.0.0.1'), '127.0.0.1|register')
  assert.equal(rateLimit.publicRateLimitKey('10.0.0.1'), '10.0.0.1|public')
  assert.equal(rateLimit.rateLimitKey(undefined, 'auth'), 'unknown|auth')
  assert.equal(rateLimit.rateLimitKey('bad|key!!', 'public'), 'badkey|public')
})

test('Part 1: error logs and app wiring include security headers and request IDs', () => {
  const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
  const app = read('backend/index.ts')
  const errorHandler = read('backend/middleware/errorHandler.ts')
  assert.match(app, /X-Content-Type-Options/)
  assert.match(app, /X-Frame-Options/)
  assert.match(app, /Referrer-Policy/)
  assert.match(app, /Permissions-Policy/)
  assert.match(app, /X-Request-Id/)
  assert.match(app, /loginRateLimitKey/)
  assert.match(app, /registerRateLimitKey/)
  assert.match(app, /publicRateLimitKey/)
  assert.match(errorHandler, /requestId/)
})

// ---------------------------------------------------------------------------
// Part 2 — deep health and admin snapshot export
// ---------------------------------------------------------------------------

test('Part 2: health payload reports live DB status, uptime and no secrets', () => {
  const startedAt = new Date('2026-05-01T10:00:00.000Z')
  const now = new Date('2026-05-01T10:01:05.000Z')
  const ok = health.buildHealthPayload({ dbOk: true, startedAt, now, dbLatencyMs: 12.4 })
  assert.equal(ok.status, 'OK')
  assert.equal(ok.uptimeSeconds, 65)
  assert.deepEqual(ok.checks.database, { status: 'up', latencyMs: 12 })
  assert.equal(ok.timestamp, now.toISOString())

  const down = health.buildHealthPayload({ dbOk: false, startedAt, now, dbError: 'password=secret' })
  assert.equal(down.status, 'DEGRADED')
  assert.equal(down.checks.database.status, 'down')
  assert.equal(down.checks.database.latencyMs, null)
  assert.ok(!JSON.stringify(down).includes('password=secret'))
})

test('Part 2: database probe never leaks driver error text', async () => {
  const ok = await health.probeDatabase({ $queryRawUnsafe: async () => [{ '?column?': 1 }] })
  assert.deepEqual(ok, { ok: true, latencyMs: ok.latencyMs, error: null })
  const failed = await health.probeDatabase({
    $queryRawUnsafe: async () => { throw new Error('postgres://user:password@host/db') }
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.latencyMs, null)
  assert.ok(!JSON.stringify(failed).includes('password'))
})

test('Part 2: snapshot export strips secrets and covers all required models', () => {
  assert.equal(snapshot.stripSecrets({ password: 'x', tokenVersion: 2, nested: { apiKey: 'y', safe: 1 } }).nested.safe, 1)
  assert.equal(snapshot.stripSecrets({ password: 'x' }).password, undefined)
  const built = snapshot.buildSnapshot({
    organizationId: 'org-1',
    now: new Date('2026-05-01T00:00:00.000Z'),
    properties: [{ id: 'p1', title: 'Villa' }],
    owners: [{ id: 'o1', firstName: 'A' }],
    leads: [{ id: 'l1', notes: 'ok' }],
    deals: [{ id: 'd1' }],
    appointments: [{ id: 'a1' }],
    payments: [{ id: 'pay1' }],
    expenses: [{ id: 'e1' }],
    commissions: [{ id: 'c1' }],
    settings: [{ id: 's1', data: { secretValue: 'safe-to-export' } }]
  })
  assert.equal(built.organizationId, 'org-1')
  assert.equal(built.generatedAt, '2026-05-01T00:00:00.000Z')
  assert.deepEqual(built.counts, {
    properties: 1, owners: 1, leads: 1, deals: 1, appointments: 1,
    payments: 1, expenses: 1, commissions: 1, settings: 1
  })
  assert.equal(built.data.properties[0].title, 'Villa')
  assert.equal(snapshot.snapshotFilename('org-1', new Date('2026-05-01T00:00:00.000Z')), 'estateos-snapshot-org-1-2026-05-01.json')
  assert.deepEqual([...snapshot.SNAPSHOT_MODELS], [
    'properties', 'owners', 'leads', 'deals', 'appointments', 'payments', 'expenses', 'commissions', 'settings'
  ])
})

// ---------------------------------------------------------------------------
// Part 3 — bounded list queries
// ---------------------------------------------------------------------------

test('Part 3: list query guard requires a finite bounded take', () => {
  assert.equal(queryAudit.isBounded({ take: 20 }), true)
  assert.equal(queryAudit.isBounded({ take: 100 }), true)
  assert.equal(queryAudit.isBounded({ take: 101 }), false)
  assert.equal(queryAudit.isBounded({}), false)
  assert.equal(queryAudit.isBounded(null), false)
  assert.equal(queryAudit.isBounded({ first: 1 }), true)
  const findings = queryAudit.auditUnboundedFindMany({
    'good.js': 'prisma.property.findMany({ where, take: limit, skip })',
    'bad.js': 'prisma.deal.findMany({ where })'
  })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].file, 'bad.js')
})

// ---------------------------------------------------------------------------
// Wiring checks
// ---------------------------------------------------------------------------

test('Package 10: health, export endpoint and docs are wired', () => {
  const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
  const app = read('backend/index.ts')
  const admin = read('backend/routes/admin.ts')
  const settingsView = read('frontend/src/views/SettingsView.vue')
  const readme = read('README.md')
  const runbook = read('RUNBOOK.md')
  const architecture = read('ARCHITECTURE.md')

  assert.match(app, /\/api\/health/)
  assert.match(app, /probeDatabase/)
  assert.match(admin, /export-snapshot/)
  assert.match(admin, /Role\.ADMIN/)
  assert.match(admin, /buildSnapshot/)
  assert.match(settingsView, /Download Backup Snapshot/)
  assert.match(readme, /Package 5/)
  assert.match(readme, /Package 10/)
  assert.match(runbook, /Package 5/)
  assert.match(runbook, /Package 10/)
  assert.match(architecture, /Package 5/)
  assert.match(architecture, /Package 10/)
})
