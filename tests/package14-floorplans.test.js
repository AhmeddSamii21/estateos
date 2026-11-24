const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const bcrypt = require('bcrypt')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.NODE_ENV = 'test'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'
process.env.PUBLIC_RATE_LIMIT_MAX = '1000'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')
const { removeDocument } = require('../dist-backend/storage/local.js')
const {
  parseAttachmentKind,
  serializeAttachment,
  validateAttachmentUrl
} = require('../dist-backend/utils/propertyAttachments.js')

const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG14-${runId}`
const state = { orgAId: null, orgBId: null, propertyId: null, userIds: [], storageKeys: [] }
let server
let baseUrl

async function api(method, path, options = {}) {
  const headers = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.body !== undefined && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : (options.body instanceof FormData ? options.body : JSON.stringify(options.body))
  })
  const text = await response.text()
  let data = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  return { status: response.status, data, headers: response.headers }
}

async function createFixtureOrg(suffix, key) {
  const organization = await prisma.organization.create({
    data: {
      name: `${tag} ${suffix}`,
      slug: `${tag.toLowerCase()}-${suffix.toLowerCase()}`,
      currency: 'USD',
      baseCurrency: 'USD'
    },
    select: { id: true }
  })
  const password = `Package14!${crypto.randomBytes(10).toString('base64url')}`
  const user = await prisma.user.create({
    data: {
      email: `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`,
      password: await bcrypt.hash(password, 10),
      role: 'ADMIN',
      organizationId: organization.id,
      firstName: 'Package 14',
      isActive: true
    },
    select: { id: true, email: true }
  })
  state.userIds.push(user.id)
  const login = await api('POST', '/api/auth/login', {
    body: { email: user.email, password }
  })
  assert.equal(login.status, 200, `login should succeed for ${key}`)
  return { organizationId: organization.id, token: login.data.data.token }
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const orgA = await createFixtureOrg('a', 'admin-a')
  state.orgAId = orgA.organizationId
  state.tokenA = orgA.token
  const orgB = await createFixtureOrg('b', 'admin-b')
  state.orgBId = orgB.organizationId
  state.tokenB = orgB.token

  const property = await prisma.property.create({
    data: {
      referenceNumber: `${tag}-PROPERTY`,
      title: 'Floorplan test property',
      type: 'APARTMENT',
      organizationId: state.orgAId,
      publicShareEnabled: true,
      publicShareToken: crypto.randomBytes(24).toString('base64url'),
      publicShareExpiresAt: new Date(Date.now() + 86_400_000)
    },
    select: { id: true, publicShareToken: true }
  })
  state.propertyId = property.id
  state.shareToken = property.publicShareToken
})

test.after(async () => {
  try {
    for (const storageKey of state.storageKeys) {
      await removeDocument(storageKey).catch(() => {})
    }
    if (state.orgAId || state.orgBId) {
      const organizationIds = [state.orgAId, state.orgBId].filter(Boolean)
      await prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({ where: { organizationId: { in: organizationIds } } })
        await tx.auditLog.deleteMany({ where: { userId: { in: state.userIds } } })
        await tx.property.deleteMany({ where: { organizationId: { in: organizationIds } } })
        await tx.user.deleteMany({ where: { organizationId: { in: organizationIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: organizationIds } } })
        await tx.organization.deleteMany({ where: { id: { in: organizationIds } } })
      })
    }
  } finally {
    await shutdown()
  }
})

test('attachment helpers accept only explicit kinds and safe external links', () => {
  assert.equal(parseAttachmentKind('FLOORPLAN'), 'FLOORPLAN')
  assert.equal(parseAttachmentKind('BROCHURE'), 'BROCHURE')
  assert.equal(parseAttachmentKind(undefined, 'BROCHURE'), 'BROCHURE')
  assert.throws(() => parseAttachmentKind('CONTRACT'), /FLOORPLAN or BROCHURE/)
  assert.equal(validateAttachmentUrl('https://example.com/plan.pdf'), 'https://example.com/plan.pdf')
  assert.throws(() => validateAttachmentUrl('javascript:alert(1)'), /http\(s\)/)
  assert.throws(() => validateAttachmentUrl(''), /required/)

  const serialized = serializeAttachment({
    id: 'attachment-1',
    name: 'Plan',
    url: 'secret-storage-key',
    kind: 'FLOORPLAN',
    mimeType: 'application/pdf',
    originalName: 'plan.pdf',
    size: 12,
    sortOrder: 0,
    storageKey: 'secret-storage-key'
  }, '/api/properties/p/attachments/a/content')
  assert.equal(serialized.url, '')
  assert.equal(serialized.contentUrl, '/api/properties/p/attachments/a/content')
  assert.equal('storageKey' in serialized, false)
})

test('property floorplans and brochures can be linked, uploaded, listed and removed', async () => {
  const propertyPath = `/api/properties/${state.propertyId}/attachments`

  const linked = await api('POST', propertyPath, {
    token: state.tokenA,
    body: { kind: 'FLOORPLAN', name: 'Floor plan A', url: 'https://example.com/floorplan.pdf' }
  })
  assert.equal(linked.status, 201, JSON.stringify(linked.data))
  assert.equal(linked.data.data.kind, 'FLOORPLAN')
  assert.equal(linked.data.data.url, 'https://example.com/floorplan.pdf')
  assert.equal(linked.data.data.contentUrl, null)

  const invalidKind = await api('POST', propertyPath, {
    token: state.tokenA,
    body: { kind: 'CONTRACT', name: 'Nope', url: 'https://example.com/nope.pdf' }
  })
  assert.equal(invalidKind.status, 400)

  const form = new FormData()
  form.append('kind', 'BROCHURE')
  form.append('file', new Blob(['%PDF-1.4\nEstateOS package 14\n%%EOF'], { type: 'application/pdf' }), 'brochure.pdf')
  const uploaded = await api('POST', propertyPath, { token: state.tokenA, body: form })
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data))
  assert.equal(uploaded.data.data.kind, 'BROCHURE')
  assert.match(uploaded.data.data.contentUrl, /\/content$/)
  const uploadedId = uploaded.data.data.id
  const stored = await prisma.propertyDocument.findUniqueOrThrow({ where: { id: uploadedId } })
  state.storageKeys.push(stored.storageKey)

  const planList = await api('GET', `${propertyPath}?kind=FLOORPLAN`, { token: state.tokenA })
  assert.equal(planList.status, 200)
  assert.equal(planList.data.data.length, 1)
  assert.equal(planList.data.data[0].name, 'Floor plan A')

  const allList = await api('GET', propertyPath, { token: state.tokenA })
  assert.equal(allList.data.data.length, 2)

  const detail = await api('GET', `/api/properties/${state.propertyId}`, { token: state.tokenA })
  assert.equal(detail.status, 200)
  assert.equal(detail.data.data.attachments.length, 2)
  assert.equal(detail.data.data.attachments.some((item) => 'storageKey' in item), false)

  const content = await api('GET', uploaded.data.data.contentUrl, { token: state.tokenA })
  assert.equal(content.status, 200)
  assert.match(content.headers.get('content-type') || '', /application\/pdf/)
  assert.equal(content.headers.get('x-content-type-options'), 'nosniff')

  const crossTenant = await api('GET', propertyPath, { token: state.tokenB })
  assert.equal(crossTenant.status, 404)

  const removed = await api('DELETE', `${propertyPath}/${uploadedId}`, { token: state.tokenA })
  assert.equal(removed.status, 200)
  const afterRemove = await api('GET', propertyPath, { token: state.tokenA })
  assert.equal(afterRemove.data.data.length, 1)
})

test('active public share pages expose only floorplans and brochures', async () => {
  const publicResponse = await api('GET', `/api/public/properties/${state.shareToken}`)
  assert.equal(publicResponse.status, 200, JSON.stringify(publicResponse.data))
  assert.equal(publicResponse.data.data.attachments.length, 1)
  assert.equal(publicResponse.data.data.attachments[0].kind, 'FLOORPLAN')
  assert.equal('storageKey' in publicResponse.data.data.attachments[0], false)

  const list = await api('GET', `/api/public/properties/${state.shareToken}/attachments`)
  assert.equal(list.status, 200)
  assert.equal(list.data.data.length, 1)

  const missing = await api('GET', '/api/public/properties/not-a-valid-share-token/attachments')
  assert.equal(missing.status, 404)
})
