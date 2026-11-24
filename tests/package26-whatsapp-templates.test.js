const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const bcrypt = require('bcrypt')

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production'
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'

const { start, shutdown } = require('../dist-backend/index.js')
const { prisma } = require('../dist-backend/prisma.js')

// The pure ESM core is shared with frontend/src/utils/whatsapp.ts so the UI
// and the tests exercise exactly the same template/phone logic.
const {
  buildWhatsAppTemplate,
  buildWhatsAppMessageLink,
  buildWhatsAppUrl,
  normalizeWhatsAppPhone,
  propertySharePath,
  renderWhatsAppTemplate
} = require('../frontend/src/utils/whatsappCore.mjs')

test('normalizes Egyptian local and international phone numbers safely', () => {
  assert.equal(normalizeWhatsAppPhone('01001234567'), '201001234567')
  assert.equal(normalizeWhatsAppPhone('+20 100 123 4567'), '201001234567')
  assert.equal(normalizeWhatsAppPhone('0020 100 123 4567'), '201001234567')
  assert.equal(normalizeWhatsAppPhone('(+20) 01001234567'), '201001234567')
  assert.equal(normalizeWhatsAppPhone('+971 50 123 4567'), '971501234567')
  assert.equal(normalizeWhatsAppPhone('  '), null)
  assert.equal(normalizeWhatsAppPhone('call me'), null)
  assert.equal(normalizeWhatsAppPhone('12345'), null)
  assert.equal(normalizeWhatsAppPhone('00000000000'), null)
})

test('property share template includes specs, price and the public /p/:token link in both languages', () => {
  const payload = {
    title: 'Nile View Apartment',
    reference: 'REF-123',
    price: '250000',
    currency: 'USD',
    city: 'Cairo',
    bedrooms: 3,
    bathrooms: 2,
    area: 180,
    token: 'public-token-1',
    origin: 'https://estateos.example/'
  }

  const en = buildWhatsAppTemplate('propertyShare', payload, 'en')
  assert.equal(en.language, 'en')
  assert.match(en.text, /Nile View Apartment/)
  assert.match(en.text, /REF-123/)
  assert.match(en.text, /3 bed/)
  assert.match(en.text, /2 bath/)
  assert.match(en.text, /180 m²/)
  assert.match(en.text, /250000 USD/)
  assert.match(en.text, /https:\/\/estateos\.example\/p\/public-token-1/)

  const ar = buildWhatsAppTemplate('propertyShare', payload, 'ar')
  assert.equal(ar.language, 'ar')
  assert.match(ar.text, /عقار/)
  assert.match(ar.text, /السعر/)
  assert.match(ar.text, /التفاصيل/)
  assert.match(ar.text, /https:\/\/estateos\.example\/p\/public-token-1/)
  assert.notEqual(ar.text, en.text)
})

test('appointment confirmation and reminder templates are bilingual and include the schedule', () => {
  const payload = {
    customerName: 'Sara',
    title: 'Nile View Apartment',
    startsAt: '2026-12-02T15:30:00Z',
    location: 'Office - Cairo',
    token: 'apt-token'
  }

  const confirmation = buildWhatsAppTemplate('appointmentConfirmation', payload, 'en')
  assert.match(confirmation.text, /Appointment confirmed/)
  assert.match(confirmation.text, /Sara/)
  assert.match(confirmation.text, /Nile View Apartment/)
  assert.match(confirmation.text, /Office - Cairo/)
  assert.match(confirmation.text, /2026/)

  const reminder = buildWhatsAppTemplate('appointmentReminder', payload, 'ar')
  assert.match(reminder.text, /تذكير بالموعد/)
  assert.match(reminder.text, /عزيزي Sara/)
  assert.match(reminder.text, /العقار/)
  assert.match(reminder.text, /2026/)
})

test('installment reminder shows due date and remaining balance only from public payment fields', () => {
  const payload = {
    customerName: 'Ahmed',
    reference: 'DEAL-9',
    dueDate: '2026-12-15T00:00:00Z',
    amount: '1500',
    remainingBalance: '4500',
    currency: 'EGP'
  }

  const en = buildWhatsAppTemplate('installmentReminder', payload, 'en')
  assert.match(en.text, /Installment payment reminder/)
  assert.match(en.text, /Due date/)
  assert.match(en.text, /2026/)
  assert.match(en.text, /1500 EGP/)
  assert.match(en.text, /Remaining balance/)
  assert.match(en.text, /4500 EGP/)

  const ar = buildWhatsAppTemplate('installmentReminder', payload, 'ar')
  assert.match(ar.text, /تذكير بدفعة قسط/)
  assert.match(ar.text, /تاريخ الاستحقاق/)
  assert.match(ar.text, /الرصيد المتبقي/)
  assert.doesNotMatch(ar.text, /notes|password|token/i)
})

test('lead follow-up template is bilingual and never includes internal notes', () => {
  const en = buildWhatsAppTemplate('leadFollowUp', { customerName: 'Sara', title: 'Nile View Apartment', notes: 'internal note' }, 'en')
  assert.match(en.text, /Following up on your enquiry/)
  assert.match(en.text, /Sara/)
  assert.doesNotMatch(en.text, /internal note/)

  const ar = buildWhatsAppTemplate('leadFollowUp', { customerName: 'Sara' }, 'ar')
  assert.match(ar.text, /متابعة طلبك/)
})

test('wa.me links encode the localized message and never accept malformed numbers', () => {
  const url = buildWhatsAppMessageLink({
    phone: '01001234567',
    template: 'propertyShare',
    payload: { title: 'Flat & Garden', token: 'tk 1', origin: 'https://example.test' },
    language: 'en'
  })
  assert.ok(url)
  assert.match(url, /^https:\/\/wa\.me\/201001234567\?text=/)
  // URLSearchParams already decodes the query value once.
  const message = new URL(url).searchParams.get('text')
  assert.match(message, /Flat & Garden/)
  assert.match(message, /\/p\/tk%201/)
  assert.equal(buildWhatsAppUrl('not-a-phone', 'hello'), null)
  assert.equal(buildWhatsAppMessageLink({ phone: '', template: 'propertyShare', payload: {} }), null)
})

test('custom template overrides resolve {{placeholders}} without leaking unknown values', () => {
  const rendered = renderWhatsAppTemplate('Hi {{customerName}} — {{title}} {{unknown}}', {
    customerName: 'Sara',
    title: 'Villa',
    notes: 'internal secret'
  })
  assert.equal(rendered, 'Hi Sara — Villa')
  assert.doesNotMatch(rendered, /internal secret/)

  const overridden = buildWhatsAppTemplate(
    'installmentReminder',
    { dueDate: '2026-12-15T00:00:00Z', remainingBalance: '900', currency: 'USD' },
    'en',
    { installmentReminder: 'Balance {{remainingBalance}} {{currency}}' }
  )
  assert.equal(overridden.text, 'Balance 900 USD')
  assert.equal(propertySharePath('abc', 'https://example.test/'), 'https://example.test/p/abc')
})

// --- Tenant-scoped optional template overrides stored in Settings.data ---
const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const tag = `PKG26-${runId}`
const apiState = { orgAId: null, orgBId: null, tokens: {}, userIds: [] }
let server
let baseUrl

async function api(method, path, options = {}) {
  const headers = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : null }
}

async function createOrg(suffix) {
  const org = await prisma.organization.create({
    data: {
      name: `${tag} ${suffix}`,
      slug: `${tag.toLowerCase()}-${suffix.toLowerCase()}`,
      currency: 'USD',
      baseCurrency: 'USD'
    },
    select: { id: true }
  })
  return org.id
}

async function createUser(key, organizationId, role) {
  const password = `Package26!${crypto.randomBytes(10).toString('base64url')}`
  const email = `${tag.toLowerCase()}-${key.toLowerCase()}@example.invalid`
  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 10),
      role,
      organizationId,
      firstName: `Package ${key}`,
      isActive: true
    },
    select: { id: true }
  })
  apiState.userIds.push(user.id)
  const login = await api('POST', '/api/auth/login', { body: { email, password } })
  assert.equal(login.status, 200, `${key} login should succeed`)
  apiState.tokens[key] = login.data.data.token
}

test.before(async () => {
  server = start(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  apiState.orgAId = await createOrg('a')
  apiState.orgBId = await createOrg('b')
  await createUser('ADMIN_A', apiState.orgAId, 'ADMIN')
  await createUser('AGENT_A', apiState.orgAId, 'AGENT')
  await createUser('ADMIN_B', apiState.orgBId, 'ADMIN')
})

test.after(async () => {
  try {
    const organizationIds = [apiState.orgAId, apiState.orgBId].filter(Boolean)
    if (organizationIds.length) {
      const users = await prisma.user.findMany({
        where: { organizationId: { in: organizationIds } },
        select: { id: true }
      })
      const userIds = [...new Set([...apiState.userIds, ...users.map((user) => user.id)])]
      await prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({ where: { userId: { in: userIds } } })
        await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })
        await tx.user.deleteMany({ where: { organizationId: { in: organizationIds } } })
        await tx.settings.deleteMany({ where: { organizationId: { in: organizationIds } } })
        await tx.organization.deleteMany({ where: { id: { in: organizationIds } } })
      })
    }
  } finally {
    await shutdown()
  }
})

test('WhatsApp template overrides are tenant-scoped, management-only and additive', async () => {
  const initial = await api('GET', '/api/settings/whatsapp-templates', { token: apiState.tokens.ADMIN_A })
  assert.equal(initial.status, 200, JSON.stringify(initial.data))
  assert.deepEqual(initial.data.data.templates, { en: {}, ar: {} })

  const denied = await api('GET', '/api/settings/whatsapp-templates', { token: apiState.tokens.AGENT_A })
  assert.equal(denied.status, 403)

  const saved = await api('PATCH', '/api/settings/whatsapp-templates', {
    token: apiState.tokens.ADMIN_A,
    body: { templates: { en: { leadFollowUp: 'Hello {{customerName}}' }, ar: { leadFollowUp: 'مرحباً {{customerName}}' } } }
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))
  assert.equal(saved.data.data.templates.en.leadFollowUp, 'Hello {{customerName}}')
  assert.equal(saved.data.data.templates.ar.leadFollowUp, 'مرحباً {{customerName}}')

  const settings = await prisma.settings.findUnique({ where: { organizationId: apiState.orgAId } })
  assert.equal(settings.defaultLanguage, 'en')
  assert.equal(settings.defaultCurrency, 'USD')

  // A partial update keeps previously saved keys in both languages.
  const updated = await api('PATCH', '/api/settings/whatsapp-templates', {
    token: apiState.tokens.ADMIN_A,
    body: { templates: { en: { installmentReminder: 'Pay {{amount}} {{currency}}' } } }
  })
  assert.equal(updated.status, 200, JSON.stringify(updated.data))
  assert.equal(updated.data.data.templates.en.leadFollowUp, 'Hello {{customerName}}')
  assert.equal(updated.data.data.templates.en.installmentReminder, 'Pay {{amount}} {{currency}}')

  const otherTenant = await api('GET', '/api/settings/whatsapp-templates', { token: apiState.tokens.ADMIN_B })
  assert.equal(otherTenant.status, 200, JSON.stringify(otherTenant.data))
  assert.deepEqual(otherTenant.data.data.templates, { en: {}, ar: {} })
})

test('invalid WhatsApp template overrides are rejected without saving', async () => {
  const badKey = await api('PATCH', '/api/settings/whatsapp-templates', {
    token: apiState.tokens.ADMIN_A,
    body: { templates: { en: { notes: 'internal note' } } }
  })
  assert.equal(badKey.status, 400)

  const badLanguage = await api('PATCH', '/api/settings/whatsapp-templates', {
    token: apiState.tokens.ADMIN_A,
    body: { templates: { fr: {} } }
  })
  assert.equal(badLanguage.status, 400)

  const badPlaceholder = await api('PATCH', '/api/settings/whatsapp-templates', {
    token: apiState.tokens.ADMIN_A,
    body: { templates: { en: { leadFollowUp: 'Hi {{notes.password}}' } } }
  })
  assert.equal(badPlaceholder.status, 400)

  const after = await api('GET', '/api/settings/whatsapp-templates', { token: apiState.tokens.ADMIN_A })
  assert.equal(after.data.data.templates.en.leadFollowUp, 'Hello {{customerName}}')
})
