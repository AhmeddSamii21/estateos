const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

process.env.NODE_ENV = 'test'

const csvImport = require('../dist-backend/utils/csvImport.js')
const installments = require('../dist-backend/utils/installmentSchedule.js')
const notificationTargets = require('../dist-backend/utils/notificationTargets.js')

// ---------------------------------------------------------------------------
// Part 1 — CSV parsing, validation preview, and import templates
// ---------------------------------------------------------------------------

test('Part 1: CSV parser handles quoted commas, escaped quotes, CRLF and multiline cells', () => {
  const parsed = csvImport.parseCsv('\uFEFFtitle,price,notes\r\n"Sea, View","1250.50","Line 1\r\nLine ""2"""\r\nVilla,900,ok\r\n')
  assert.deepEqual(parsed.headers, ['title', 'price', 'notes'])
  assert.equal(parsed.records.length, 2)
  assert.equal(parsed.records[0].row, 1)
  assert.deepEqual(parsed.records[0].cells, {
    title: 'Sea, View',
    price: '1250.50',
    notes: 'Line 1\nLine "2"'
  })
  assert.equal(parsed.records[1].row, 2)
  assert.deepEqual(parsed.records[1].cells, { title: 'Villa', price: '900', notes: 'ok' })
})

test('Part 1: import preview applies existing validation rules per row without throwing', () => {
  const fields = [
    { key: 'title', header: 'Full Title', type: 'string', required: true, maxLength: 30 },
    { key: 'price', header: 'Price', type: 'money', required: true, min: 0 },
    { key: 'status', header: 'Status', type: 'enum', allowed: ['AVAILABLE', 'SOLD'], fallback: 'AVAILABLE' },
    { key: 'area', header: 'Area', type: 'number', min: 0 },
    { key: 'availableFrom', header: 'Available From', type: 'date' }
  ]
  const csv = [
    'full-title,price,status,area,available-from',
    'Flat,1250.50,SOLD,120.5,2026-05-01',
    ',not-money,UNKNOWN,-4,yesterday'
  ].join('\n')
  const preview = csvImport.buildImportPreview(csv, fields)

  assert.equal(preview.rows.length, 2)
  assert.equal(preview.validCount, 1)
  assert.equal(preview.invalidCount, 1)
  assert.deepEqual(preview.rows[0].errors, [])
  assert.equal(preview.rows[0].values.title, 'Flat')
  assert.equal(preview.rows[0].values.price, '1250.50')
  assert.equal(preview.rows[0].values.status, 'SOLD')
  assert.equal(preview.rows[0].values.area, 120.5)
  assert.equal(preview.rows[0].values.availableFrom, '2026-05-01')

  const errorFields = preview.rows[1].errors.map((issue) => issue.field)
  assert.deepEqual(errorFields, ['title', 'price', 'status', 'area', 'availableFrom'])
})

test('Part 1: templates expose the exported property and lead headers', () => {
  const { PROPERTY_IMPORT_FIELDS } = require('../dist-backend/utils/propertyImport.js')
  const { LEAD_IMPORT_FIELDS } = require('../dist-backend/utils/leadImport.js')
  const propertyHeaders = csvImport.importHeaders(PROPERTY_IMPORT_FIELDS)
  const leadHeaders = csvImport.importHeaders(LEAD_IMPORT_FIELDS)

  assert.ok(propertyHeaders.includes('title'))
  assert.ok(propertyHeaders.includes('price'))
  assert.ok(propertyHeaders.includes('type'))
  assert.ok(leadHeaders.includes('firstName'))
  assert.ok(leadHeaders.includes('status'))

  const template = csvImport.importTemplate(PROPERTY_IMPORT_FIELDS)
  const lines = template.trimEnd().split(/\r?\n/)
  assert.equal(lines[0], propertyHeaders.join(','))
  assert.equal(lines.length, 2)
})

// ---------------------------------------------------------------------------
// Part 2 — installment math, month clamping, and payment references
// ---------------------------------------------------------------------------

test('Part 2: installment schedule divides the financed amount and clamps month ends', () => {
  const schedule = installments.buildInstallmentSchedule({
    dealAmount: '1000.00',
    downPayment: '100.00',
    installmentCount: 3,
    frequency: 'QUARTERLY',
    firstDueDate: '2026-01-31'
  })

  assert.equal(schedule.downPayment, '100.00')
  assert.equal(schedule.financedAmount, '900.00')
  assert.equal(schedule.installmentCount, 3)
  assert.equal(schedule.frequency, 'QUARTERLY')
  assert.deepEqual(schedule.installments.map((row) => row.amount), ['300.00', '300.00', '300.00'])
  assert.deepEqual(schedule.installments.map((row) => row.dueAt), ['2026-01-31', '2026-04-30', '2026-07-31'])
  assert.equal(schedule.total, '1000.00')
})

test('Part 2: rounding remainder is assigned to the last installment', () => {
  const schedule = installments.buildInstallmentSchedule({
    dealAmount: '1000.00',
    downPayment: 0,
    installmentCount: 3,
    frequency: 'MONTHLY',
    firstDueDate: '2026-03-01'
  })
  assert.deepEqual(schedule.installments.map((row) => row.amount), ['333.33', '333.33', '333.34'])
  assert.equal(schedule.total, '1000.00')
})

test('Part 2: invalid installment input fails with readable validation errors', () => {
  assert.throws(() => installments.buildInstallmentSchedule({
    dealAmount: '100.00', downPayment: '150.00', installmentCount: 2,
    frequency: 'MONTHLY', firstDueDate: '2026-01-01'
  }), /downPayment|financed/i)
  assert.throws(() => installments.buildInstallmentSchedule({
    dealAmount: '100.00', downPayment: 0, installmentCount: 0,
    frequency: 'MONTHLY', firstDueDate: '2026-01-01'
  }), /installmentCount/i)
  assert.throws(() => installments.buildInstallmentSchedule({
    dealAmount: '100.00', downPayment: 0, installmentCount: 1,
    frequency: 'WEEKLY', firstDueDate: '2026-01-01'
  }), /frequency/i)
  assert.deepEqual(installments.installmentPaymentReferences('batch_1', 2), ['INST-batch_1-1', 'INST-batch_1-2'])
})

// ---------------------------------------------------------------------------
// Part 3 — notification category and safe target resolution
// ---------------------------------------------------------------------------

test('Part 3: notification targets are restricted to an explicit frontend allowlist', () => {
  const resolve = notificationTargets.resolveNotificationTarget
  assert.equal(resolve({ entityType: 'Property', entityId: 'prop-1' }), '/properties/prop-1')
  assert.equal(resolve({ entityType: 'Deal', entityId: 'deal-1' }), '/deals/deal-1')
  assert.equal(resolve({ entityType: 'Lead', entityId: 'lead-1' }), '/leads')
  assert.equal(resolve({ entityType: 'Appointment', entityId: 'a1' }), '/appointments')
  assert.equal(resolve({ entityType: 'Commission', entityId: 'c1' }), '/finance/commission-statements')

  assert.equal(resolve({ entityType: 'Property', entityId: '../secret' }), null)
  assert.equal(resolve({ entityType: 'Property', entityId: '' }), null)
  assert.equal(resolve({ actionUrl: 'javascript:alert(1)' }), null)
  assert.equal(resolve({ actionUrl: '/deals/../../admin' }), null)
  assert.equal(resolve({ actionUrl: '/leads' }), '/leads')
})

test('Part 3: notification types map to stable filter categories', () => {
  const category = notificationTargets.notificationCategoryOf
  assert.equal(category('PROPERTY_STATUS_CHANGED'), 'PROPERTY')
  assert.equal(category('LEAD_CREATED'), 'LEAD')
  assert.equal(category('DEAL_STATUS_CHANGED'), 'DEAL')
  assert.equal(category('APPOINTMENT_OUTCOME_REMINDER'), 'APPOINTMENT')
  assert.equal(category('PAYMENT_RECORDED'), 'FINANCE')
  assert.equal(category('COMMISSION_STATUS_CHANGED'), 'FINANCE')
  assert.equal(category('MAINTENANCE_CREATED'), 'MAINTENANCE')
  assert.equal(category('UNKNOWN_EVENT'), 'SYSTEM')
  assert.equal(notificationTargets.notificationTypeMatchesCategory('PAYMENT_RECORDED', 'FINANCE'), true)
  assert.equal(notificationTargets.notificationTypeMatchesCategory('PAYMENT_RECORDED', 'PROPERTY'), false)
  assert.equal(notificationTargets.notificationTypeMatchesCategory('PAYMENT_RECORDED', 'ALL'), true)
})

// ---------------------------------------------------------------------------
// UI/route wiring (SFCs are not executed by Node tests)
// ---------------------------------------------------------------------------

test('Package 8: backend routes, schema and frontend actions are wired', () => {
  const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
  const propertiesRoute = read('backend/routes/properties.ts')
  const leadsRoute = read('backend/routes/leads.ts')
  const dealsRoute = read('backend/routes/deals.ts')
  const notificationsRoute = read('backend/routes/notifications.ts')
  const schema = read('prisma/schema.prisma')
  const propertyList = read('frontend/src/views/PropertyList.vue')
  const resourceView = read('frontend/src/views/ResourceView.vue')
  const dealDetail = read('frontend/src/views/DealDetail.vue')
  const notificationsView = read('frontend/src/views/NotificationsView.vue')
  const layout = read('frontend/src/components/Layout.vue')

  assert.match(propertiesRoute, /router\.post\('\/import'/)
  assert.match(propertiesRoute, /PROPERTY_IMPORT_FIELDS/)
  assert.match(leadsRoute, /router\.post\('\/import'/)
  assert.match(leadsRoute, /LEAD_IMPORT_FIELDS/)
  assert.match(dealsRoute, /router\.post\('\/:id\/installments'/)
  assert.match(dealsRoute, /buildInstallmentSchedule/)
  assert.match(notificationsRoute, /notificationCategoryTypeFilter/)
  assert.match(notificationsRoute, /resolveNotificationTarget/)
  assert.match(schema, /model Payment \{[\s\S]*?dueAt\s+DateTime\?/)
  assert.match(propertyList, /ImportCsvModal/)
  assert.match(propertyList, /\/properties\/import/)
  assert.match(resourceView, /ImportCsvModal/)
  assert.match(resourceView, /\/leads\/import/)
  assert.match(resourceView, /useRouter/)
  assert.match(dealDetail, /Installment calculator/i)
  assert.match(dealDetail, /\/installments/)
  assert.match(notificationsView, /NOTIFICATION_CATEGORIES/)
  assert.match(notificationsView, /resolveNotificationTarget/)
  assert.match(layout, /resolveNotificationTarget/)
})
