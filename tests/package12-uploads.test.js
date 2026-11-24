const test = require('node:test')
const assert = require('node:assert/strict')

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'

const jwt = require('jsonwebtoken')
const { PrismaClient } = require('@prisma/client')
const { start, shutdown } = require('../dist-backend/index.js')
const files = require('../dist-backend/utils/files.js')
const { removeDocument, removePropertyImage } = require('../dist-backend/storage/local.js')

const prisma = new PrismaClient()
const created = { documentIds: [], propertyId: null, imageIds: [], storageKeys: [] }
let baseUrl
let admin
let adminToken
let agentToken

function tokenFor(user) {
  return jwt.sign({ id: user.id, tokenVersion: user.tokenVersion }, process.env.JWT_SECRET, { expiresIn: '10m' })
}

function headers(token) {
  return { Authorization: `Bearer ${token}` }
}

function form(fields, { name, mimeType, buffer }, field = 'file') {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  data.append(field, new Blob([buffer], { type: mimeType }), name)
  return data
}

async function expectStatus(response, status) {
  const text = await response.text()
  assert.equal(response.status, status, text)
  return JSON.parse(text)
}

const PDF_BUFFER = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
)

test.before(async () => {
  const server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true, deletedAt: null },
    select: { id: true, tokenVersion: true, organizationId: true }
  })
  if (!admin) throw new Error('Package 12 smoke test needs an active ADMIN user in the database')
  adminToken = tokenFor(admin)

  const agent = await prisma.user.findFirst({
    where: { role: 'AGENT', isActive: true, deletedAt: null, organizationId: admin.organizationId },
    select: { id: true, tokenVersion: true }
  })
  if (agent) agentToken = tokenFor(agent)
})

test.after(async () => {
  if (created.documentIds.length) await prisma.document.deleteMany({ where: { id: { in: created.documentIds } } })
  if (created.propertyId) await prisma.property.delete({ where: { id: created.propertyId } }).catch(() => {})
  for (const key of created.storageKeys) {
    await removeDocument(key).catch(() => {})
    await removePropertyImage(key).catch(() => {})
  }
  await prisma.$disconnect()
  await shutdown()
})

test('upload validation rejects traversal keys, mismatched extensions and spoofed image content', () => {
  assert.throws(() => files.assertSafeStorageKey('../../etc/passwd'), /Invalid document storage key/)
  assert.throws(() => files.assertSafeStorageKey('..\\secrets.pdf'), /Invalid document storage key/)
  assert.doesNotThrow(() => files.assertSafeStorageKey(files.createStorageKey('../../invoice.pdf')))
  assert.equal(files.sanitizeOriginalName('..\\..\\lease agreement.pdf'), 'lease agreement.pdf')

  assert.throws(
    () => files.validateDocumentFile({ originalname: 'invoice.exe', mimetype: 'application/pdf', size: 10 }),
    /extension/
  )
  assert.throws(
    () => files.validateDocumentFile({ originalname: 'invoice.pdf', mimetype: 'application/zip', size: 10 }),
    /Unsupported/
  )
  assert.throws(
    () => files.validateImageFile({ originalname: 'photo.png', mimetype: 'image/png', size: 10, buffer: PDF_BUFFER }),
    /content does not match/
  )
  assert.doesNotThrow(() =>
    files.validateImageFile({ originalname: 'photo.png', mimetype: 'image/png', size: PNG_BUFFER.length, buffer: PNG_BUFFER })
  )
})

test('document upload creates a real file with authenticated download/preview', async () => {
  const response = await fetch(`${baseUrl}/api/documents`, {
    method: 'POST',
    headers: headers(adminToken),
    body: form({ name: 'Package 12 lease', category: 'CONTRACT' }, {
      name: 'package-12-lease.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_BUFFER
    })
  })
  const body = await expectStatus(response, 201)
  assert.equal(body.success, true)
  assert.equal(body.data.originalName, 'package-12-lease.pdf')
  assert.match(body.data.storageKey, /^[a-f0-9-]{36}\.pdf$/i)
  created.documentIds.push(body.data.id)
  created.storageKeys.push(body.data.storageKey)

  const unauthenticated = await fetch(`${baseUrl}/api/documents/${body.data.id}/download`)
  assert.equal(unauthenticated.status, 401)

  const download = await fetch(`${baseUrl}/api/documents/${body.data.id}/download`, { headers: headers(adminToken) })
  assert.equal(download.status, 200)
  assert.match(download.headers.get('content-type') || '', /application\/pdf/)
  assert.match(download.headers.get('content-disposition') || '', /attachment/)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), PDF_BUFFER)

  const preview = await fetch(`${baseUrl}/api/documents/${body.data.id}/preview`, { headers: headers(adminToken) })
  assert.equal(preview.status, 200)
  assert.match(preview.headers.get('content-disposition') || '', /inline/)
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), PDF_BUFFER)
})

test('document upload rejects unsupported file types', async () => {
  const response = await fetch(`${baseUrl}/api/documents`, {
    method: 'POST',
    headers: headers(adminToken),
    body: form({ category: 'OTHER' }, {
      name: 'malware.exe',
      mimeType: 'application/pdf',
      buffer: PDF_BUFFER
    })
  })
  assert.equal(response.status, 415)
  const body = await response.json()
  assert.equal(body.success, false)
})

test('property images upload, preview, reorder, promote and delete through tenant-scoped endpoints', async () => {
  const property = await prisma.property.create({
    data: {
      referenceNumber: `PKG12-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      title: 'Package 12 upload fixture',
      type: 'APARTMENT',
      organizationId: admin.organizationId
    },
    select: { id: true }
  })
  created.propertyId = property.id

  if (agentToken) {
    const denied = await fetch(`${baseUrl}/api/properties/${property.id}/images`, {
      method: 'POST',
      headers: headers(agentToken),
      body: form({}, { name: 'unassigned.png', mimeType: 'image/png', buffer: PNG_BUFFER }, 'files')
    })
    assert.equal(denied.status, 403, 'unassigned agents must not upload images to another property')
  }

  const spoofed = await fetch(`${baseUrl}/api/properties/${property.id}/images`, {
    method: 'POST',
    headers: headers(adminToken),
    body: form({}, { name: 'fake.png', mimeType: 'image/png', buffer: PDF_BUFFER }, 'files')
  })
  assert.equal(spoofed.status, 415)

  const upload = await fetch(`${baseUrl}/api/properties/${property.id}/images`, {
    method: 'POST',
    headers: headers(adminToken),
    body: form({ caption: 'Package 12 photo' }, { name: 'package-12.png', mimeType: 'image/png', buffer: PNG_BUFFER }, 'files')
  })
  const uploaded = await expectStatus(upload, 201)
  assert.equal(uploaded.data.length, 1)
  assert.equal(uploaded.data[0].isPrimary, true)
  created.imageIds.push(uploaded.data[0].id)
  created.storageKeys.push(uploaded.data[0].storageKey)

  const list = await fetch(`${baseUrl}/api/properties/${property.id}/images`, { headers: headers(adminToken) })
  assert.equal(list.status, 200)
  assert.equal((await list.json()).data.length, 1)

  const content = await fetch(`${baseUrl}/api/properties/${property.id}/images/${uploaded.data[0].id}/content`, {
    headers: headers(adminToken)
  })
  assert.equal(content.status, 200)
  assert.match(content.headers.get('content-type') || '', /image\/png/)
  assert.match(content.headers.get('content-disposition') || '', /inline/)
  assert.deepEqual(Buffer.from(await content.arrayBuffer()), PNG_BUFFER)

  const reorder = await fetch(`${baseUrl}/api/properties/${property.id}/images/reorder`, {
    method: 'PATCH',
    headers: { ...headers(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedIds: created.imageIds })
  })
  await expectStatus(reorder, 200)

  const invalidReorder = await fetch(`${baseUrl}/api/properties/${property.id}/images/reorder`, {
    method: 'PATCH',
    headers: { ...headers(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedIds: [] })
  })
  assert.equal(invalidReorder.status, 400)

  const removed = await fetch(`${baseUrl}/api/properties/${property.id}/images/${uploaded.data[0].id}`, {
    method: 'DELETE',
    headers: headers(adminToken)
  })
  await expectStatus(removed, 200)
  created.imageIds = []

  const empty = await fetch(`${baseUrl}/api/properties/${property.id}/images`, { headers: headers(adminToken) })
  assert.equal((await empty.json()).data.length, 0)
})
