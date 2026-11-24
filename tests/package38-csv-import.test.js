const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const bcrypt = require('bcrypt')

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'

const {
  IMPORT_WIZARD_STEPS,
  canCommitImport,
  errorSummary,
  rejectedRowsCsv,
  wizardProgress,
  wizardStage
} = require('../frontend/src/utils/csvImportWizard.mjs')
const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG38-${runId}`
const state = { orgIds: [], userIds: [], tokens: {} }
let server
let baseUrl

async function api(method, requestPath, options = {}) {
  const headers = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  const text = await response.text()
  const isJson = (response.headers.get('content-type') || '').includes('application/json')
  return { status: response.status, data: text && isJson ? JSON.parse(text) : null, text, headers: response.headers }
}

async function createOrg(suffix) {
  const org = await prisma.organization.create({
    data: { name: `${tag} ${suffix}`, slug: `${tag.toLowerCase()}-${suffix}`, currency: 'USD', baseCurrency: 'USD' },
    select: { id: true }
  })
  state.orgIds.push(org.id)
  return org.id
}

async function createUser(key, organizationId, role = 'ADMIN') {
  const password = `Import38!${crypto.randomBytes(8).toString('base64url')}`
  const email = `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`
  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 4),
      role,
      organizationId,
      firstName: `${tag} ${key}`,
      isActive: true,
      accountStatus: 'ACTIVE'
    },
    select: { id: true }
  })
  state.userIds.push(user.id)
  const login = await api('POST', '/api/auth/login', { body: { email, password } })
  assert.equal(login.status, 200, `${key} login failed: ${JSON.stringify(login.data)}`)
  state.tokens[key] = login.data.data.token
  return user.id
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  const orgA = await createOrg('a')
  await createUser('ADMIN_A', orgA)
  const orgB = await createOrg('b')
  await createUser('AGENT_B', orgB, 'AGENT')
})

test.after(async () => {
  try {
    if (state.orgIds.length) {
      await prisma.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { userId: { in: state.userIds } } })
        await tx.user.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: state.orgIds } } })
        await tx.organization.deleteMany({ where: { id: { in: state.orgIds } } })
      })
    }
  } finally {
    await shutdown()
    if (server?.listening) await new Promise((resolve) => server.close(resolve))
  }
})

test('Package 38: pure wizard helpers track stages, errors and rejected rows', () => {
  assert.deepEqual([...IMPORT_WIZARD_STEPS], ['upload', 'validate', 'review', 'commit'])
  assert.equal(wizardStage(null), 'upload')
  assert.equal(wizardStage({ invalidCount: 1, validCount: 0 }), 'review')
  assert.equal(wizardStage({ invalidCount: 0, validCount: 2 }, { stage: 'commit' }), 'commit')
  assert.equal(canCommitImport(null), false)
  assert.equal(canCommitImport({ validCount: 2 }, { missingHeaders: ['email'] }), false)
  assert.equal(canCommitImport({ validCount: 2 }, {}), true)

  const preview = {
    rows: [
      { row: 2, values: { email: 'bad' }, errors: [{ field: 'email', message: 'invalid email' }] },
      { row: 3, values: { email: 'ok@example.invalid' }, errors: [] }
    ],
    validCount: 1,
    invalidCount: 1
  }
  assert.deepEqual(errorSummary(preview), { email: 1 })
  const rejected = rejectedRowsCsv(preview)
  assert.ok(rejected.startsWith('\uFEFF'))
  assert.match(rejected, /row,field,message,value/)
  assert.match(rejected, /invalid email,bad/)
  assert.deepEqual(
    { stage: wizardProgress(preview).stage, current: wizardProgress(preview).current, total: wizardProgress(preview).total },
    { stage: 'review', current: 3, total: 4 }
  )
})

test('Package 38: templates match the validated import field definitions', async () => {
  const properties = await api('GET', '/api/imports/template?kind=properties', { token: state.tokens.ADMIN_A })
  assert.equal(properties.status, 200)
  assert.match(properties.headers.get('content-type'), /text\/csv/)
  const propertyHeaders = properties.text.trim().split(/\r?\n/)[0].split(',')
  assert.ok(propertyHeaders.includes('referenceNumber'))
  assert.ok(propertyHeaders.includes('features'))
  assert.ok(propertyHeaders.includes('paymentTerms'))

  const leads = await api('GET', '/api/imports/template?kind=leads', { token: state.tokens.ADMIN_A })
  assert.equal(leads.status, 200)
  assert.match(leads.text.split(/\r?\n/)[0], /firstName,lastName,email,phone/)

  const invalid = await api('GET', '/api/imports/template?kind=deals', { token: state.tokens.ADMIN_A })
  assert.equal(invalid.status, 400)
  const anonymous = await api('GET', '/api/imports/template?kind=leads')
  assert.equal(anonymous.status, 401)
})

test('Package 38: validation previews rows, duplicate keys and error summaries', async () => {
  const template = await api('GET', '/api/imports/template?kind=leads', { token: state.tokens.ADMIN_A })
  const headers = template.text.trim().split(/\r?\n/)[0].split(',')
  const values = (firstName, email) => headers
    .map((header) => ({ firstName, email })[header] ?? '')
    .join(',')
  const csv = [
    headers.join(','),
    values('Amira', 'amira@example.invalid'),
    values('Omar', 'omar@example.invalid'),
    values('Layla', 'amira@example.invalid'),
    values('', 'other@example.invalid')
  ].join('\r\n')
  const response = await api('POST', '/api/imports/validate', {
    token: state.tokens.ADMIN_A,
    body: { kind: 'leads', csv }
  })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  const preview = response.data.data
  assert.deepEqual([...preview.steps], [...IMPORT_WIZARD_STEPS])
  assert.equal(preview.stage, 'review')
  assert.equal(preview.rows.length, 4)
  assert.equal(preview.validCount, 2)
  assert.equal(preview.invalidCount, 2)
  assert.equal(preview.duplicateCount, 1)
  assert.equal(preview.errorsByField.email, 1)
  assert.equal(preview.errorsByField.firstName, 1)
  assert.equal(preview.canCommit, true)
  assert.equal(preview.commitEndpoint, '/api/leads/import')
  assert.match(preview.rejectedRowsCsv, /duplicated in this file/)
  assert.deepEqual(preview.missingHeaders, [])
})

test('Package 38: missing headers block commit and limits are enforced', async () => {
  const response = await api('POST', '/api/imports/validate', {
    token: state.tokens.ADMIN_A,
    body: { kind: 'properties', csv: 'title,type\nFlat,APARTMENT' }
  })
  assert.equal(response.status, 200)
  assert.ok(response.data.data.missingHeaders.length > 0)
  assert.equal(response.data.data.canCommit, false)
  assert.equal(canCommitImport(response.data.data, response.data.data), false)

  const badKind = await api('POST', '/api/imports/validate', {
    token: state.tokens.ADMIN_A,
    body: { kind: 'deals', csv: 'title\nFlat' }
  })
  assert.equal(badKind.status, 400)

  const empty = await api('POST', '/api/imports/validate', {
    token: state.tokens.ADMIN_A,
    body: { kind: 'leads', csv: '   ' }
  })
  assert.equal(empty.status, 400)

  const tooMany = ['firstName,email', ...Array.from({ length: 501 }, (_, index) => `User${index},u${index}@example.invalid`)].join('\n')
  const limited = await api('POST', '/api/imports/validate', {
    token: state.tokens.ADMIN_A,
    body: { kind: 'leads', csv: tooMany }
  })
  assert.equal(limited.status, 400)
})

test('Package 38: statistics are tenant scoped and bilingual wizard UI is wired', async () => {
  const statistics = await api('GET', '/api/imports/statistics', { token: state.tokens.ADMIN_A })
  assert.equal(statistics.status, 200)
  assert.equal(statistics.data.data.properties, 0)
  assert.equal(statistics.data.data.leads, 0)
  assert.equal(statistics.data.data.maxRows, 500)

  const modal = read('frontend/src/components/ImportCsvModal.vue')
  assert.match(modal, /IMPORT_WIZARD_STEPS/)
  assert.match(modal, /wizardProgress/)
  assert.match(modal, /rejectedRowsCsv/)
  assert.match(modal, /خطوات الاستيراد/)
  assert.match(modal, /Import steps/)
  const frontendHeaders = read('frontend/src/utils/csvImport.ts')
  assert.match(frontendHeaders, /'features'/)
  assert.match(frontendHeaders, /'paymentTerms'/)
  const index = read('backend/index.ts')
  assert.match(index, /app\.use\('\/api\/imports', importRoutes\)/)
})
