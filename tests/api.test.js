const test = require('node:test')
const assert = require('node:assert/strict')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.NODE_ENV = 'test'

const { start, shutdown } = require('../dist-backend/index.js')
const { hashPassword, comparePassword } = require('../dist-backend/middleware/auth.js')

let baseUrl
let server

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
})

test.after(async () => {
  await shutdown()
})

test('health endpoint responds without authentication', async () => {
  const response = await fetch(`${baseUrl}/health`)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.status, 'OK')
  assert.ok(body.timestamp)
})

test('protected routes reject missing tokens', async () => {
  for (const path of [
    '/api/properties',
    '/api/properties/search',
    '/api/leads',
    '/api/appointments',
    '/api/deals',
    '/api/finance/payments',
    '/api/maintenance',
    '/api/documents',
    '/api/reports/summary',
    '/api/settings',
    '/api/users'
  ]) {
    const response = await fetch(`${baseUrl}${path}`)
    assert.equal(response.status, 401, `${path} should require auth`)
  }
})

test('login rejects missing fields with a validation error', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.success, false)
  assert.equal(body.error.message, 'Invalid input data')
  assert.ok(Array.isArray(body.error.issues))
})

test('unknown routes return the structured 404 response', async () => {
  const response = await fetch(`${baseUrl}/api/does-not-exist`)
  assert.equal(response.status, 404)
  const body = await response.json()
  assert.equal(body.success, false)
  assert.ok(body.error.message.includes('not found'))
})

test('invalid bearer tokens are rejected', async () => {
  const response = await fetch(`${baseUrl}/api/properties`, {
    headers: { Authorization: 'Bearer not-a-jwt' }
  })
  assert.equal(response.status, 401)
  const body = await response.json()
  assert.equal(body.success, false)
})

test('passwords are hashed and verified without storing plaintext', async () => {
  const hash = await hashPassword('correct horse battery staple')
  assert.notEqual(hash, 'correct horse battery staple')
  assert.equal(await comparePassword('correct horse battery staple', hash), true)
  assert.equal(await comparePassword('wrong password', hash), false)
})
