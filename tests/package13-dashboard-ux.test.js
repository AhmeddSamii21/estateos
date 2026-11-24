const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const jwt = require('jsonwebtoken')

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')
const { dateRange } = require('../dist-backend/routes/reports.js')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')

test('report date ranges accept presets, explicit dates and reject unknown presets', () => {
  assert.deepEqual(dateRange({}), {})
  assert.deepEqual(dateRange({ range: 'all' }), {})

  const seven = dateRange({ range: '7d' })
  const thirty = dateRange({ range: '30d' })
  const ninety = dateRange({ range: '90d' })
  assert.ok(seven.createdAt.gte instanceof Date)
  assert.ok(thirty.createdAt.gte.getTime() < seven.createdAt.gte.getTime())
  assert.ok(ninety.createdAt.gte.getTime() < thirty.createdAt.gte.getTime())

  const explicit = dateRange({ from: '2026-01-01', to: '2026-01-31' })
  assert.ok(explicit.createdAt.gte instanceof Date)
  assert.ok(explicit.createdAt.lte instanceof Date)
  assert.ok(dateRange({ range: 'all', from: '2026-01-01' }).createdAt.gte instanceof Date)
  assert.throws(() => dateRange({ range: '1y' }), /Invalid range/)
})

test('dashboard summary endpoint serves every range preset without a 500', async () => {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true, deletedAt: null },
    select: { id: true, tokenVersion: true }
  })
  if (!admin) throw new Error('Package 13 summary test needs an active ADMIN user')
  const token = jwt.sign({ id: admin.id, tokenVersion: admin.tokenVersion }, process.env.JWT_SECRET, { expiresIn: '10m' })

  const server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  try {
    for (const range of ['7d', '30d', '90d', 'all']) {
      const response = await fetch(`${baseUrl}/api/reports/summary?range=${range}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const text = await response.text()
      assert.equal(response.status, 200, `${range}: ${text}`)
      const body = JSON.parse(text)
      assert.equal(body.success, true)
      assert.ok(body.data)
    }
    const invalid = await fetch(`${baseUrl}/api/reports/summary?range=1y`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert.equal(invalid.status, 400)
  } finally {
    await shutdown()
  }
})

test('dashboard exposes a bilingual date-range switcher', () => {
  const dashboard = read('frontend/src/views/Dashboard.vue')
  assert.match(dashboard, /range-pills/)
  for (const preset of ['7d', '30d', '90d', 'all']) {
    assert.match(dashboard, new RegExp(`data-range="${preset}"`))
  }
  assert.match(dashboard, /آخر 7 أيام/)
  assert.match(dashboard, /آخر 30 يوم/)
  assert.match(dashboard, /آخر 90 يوم/)
  assert.match(dashboard, /الكل/)
  assert.match(dashboard, /range cutoff|rangeCutoff|scopedProperties/)
})

test('dashboard and linked views have narrow-screen table scrolling and touch targets', () => {
  const views = [
    'frontend/src/views/Dashboard.vue',
    'frontend/src/views/PropertyList.vue',
    'frontend/src/views/DealDetail.vue',
    'frontend/src/views/CommissionStatementsView.vue',
    'frontend/src/views/OwnersView.vue'
  ]
  for (const file of views) {
    const source = read(file)
    assert.match(source, /@media\s*\(max-width:\s*768px\)/, `${file} needs a 768px breakpoint`)
    assert.match(source, /overflow-x:\s*auto/, `${file} needs a horizontal scroll wrapper`)
    assert.match(source, /min-height:\s*44px/, `${file} needs touch-friendly actions`)
  }
  const dialogs = [
    'frontend/src/views/DealDetail.vue',
    'frontend/src/views/CommissionStatementsView.vue',
    'frontend/src/views/OwnersView.vue'
  ]
  assert.ok(dialogs.some((file) => /@media\s*\(max-width:\s*768px\)[\s\S]*?\.modal[\s\S]*?padding/.test(read(file))))
})
