import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { authMiddleware } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { FINANCE_ROLES, MANAGEMENT_ROLES, organizationIdOf, requireAnyRole, userIdOf } from '../utils/scope'
import { booleanValue, dateValue, numberValue, optionalString, requiredString } from '../utils/validation'
import { listExchangeRatesForOrg, resolveCurrency, upsertCurrencyRecord } from '../utils/fx'
import { parseRate } from '../utils/money'
import { logAudit } from '../utils/audit'
import { permissionMatrix } from '../utils/permissions'
import {
  EMPTY_WHATSAPP_TEMPLATES,
  sanitizeWhatsappTemplates,
  storedWhatsappTemplates,
  WHATSAPP_TEMPLATE_KEYS
} from '../utils/whatsappTemplates'

const router = Router()
// General settings stay manager-only; the FX endpoints below are additionally
// available to accountants, so role checks are applied per route.
router.use(authMiddleware)

router.get('/', async (req, res, next) => {
  try {
    requireAnyRole(req, MANAGEMENT_ROLES)
    const organizationId = organizationIdOf(req)
    const settings = await prisma.settings.findUnique({ where: { organizationId } })
    res.json({ success: true, data: settings })
  } catch (error) {
    next(error)
  }
})

router.patch('/', async (req, res, next) => {
  try {
    requireAnyRole(req, MANAGEMENT_ROLES)
    const organizationId = organizationIdOf(req)
    const defaultLanguage = optionalString(req.body?.defaultLanguage, 'defaultLanguage', 10) || 'en'
    if (!['en', 'ar'].includes(defaultLanguage)) throw createError('defaultLanguage must be en or ar', 400)
    const defaultCurrency = (optionalString(req.body?.defaultCurrency, 'defaultCurrency', 3) || 'USD').toUpperCase()

    let data: Prisma.InputJsonValue = {}
    if (req.body?.data !== undefined) {
      if (typeof req.body.data !== 'object' || req.body.data === null || Array.isArray(req.body.data)) {
        throw createError('data must be a JSON object', 400)
      }
      data = req.body.data as Prisma.InputJsonValue
    }

    const settings = await prisma.settings.upsert({
      where: { organizationId },
      create: { organizationId, defaultLanguage, defaultCurrency, data },
      update: { defaultLanguage, defaultCurrency, data }
    })
    res.json({ success: true, data: settings, message: 'Settings saved successfully' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return next(createError('Organization not found', 404))
    }
    next(error)
  }
})

// Package 26: optional bilingual WhatsApp message overrides. Stored inside
// Settings.data so the change is additive and existing settings are preserved.
router.get('/whatsapp-templates', async (req, res, next) => {
  try {
    requireAnyRole(req, MANAGEMENT_ROLES)
    const organizationId = organizationIdOf(req)
    const settings = await prisma.settings.findUnique({
      where: { organizationId },
      select: { data: true }
    })
    res.json({
      success: true,
      data: {
        templates: settings ? storedWhatsappTemplates(settings.data) : EMPTY_WHATSAPP_TEMPLATES,
        keys: WHATSAPP_TEMPLATE_KEYS
      }
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/whatsapp-templates', async (req, res, next) => {
  try {
    requireAnyRole(req, MANAGEMENT_ROLES)
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const incoming = sanitizeWhatsappTemplates(req.body?.templates)
    const current = await prisma.settings.findUnique({
      where: { organizationId },
      select: { data: true, defaultLanguage: true, defaultCurrency: true }
    })
    const currentData = current?.data && typeof current.data === 'object' && !Array.isArray(current.data)
      ? current.data as Record<string, unknown>
      : {}
    const data = {
      ...currentData,
      whatsappTemplates: {
        en: { ...storedWhatsappTemplates(currentData).en, ...incoming.en },
        ar: { ...storedWhatsappTemplates(currentData).ar, ...incoming.ar }
      }
    } as Prisma.InputJsonValue
    const settings = await prisma.$transaction(async (tx) => {
      const saved = await tx.settings.upsert({
        where: { organizationId },
        create: { organizationId, defaultLanguage: 'en', defaultCurrency: 'USD', data },
        update: { data }
      })
      await logAudit(tx, {
        userId,
        action: 'WHATSAPP_TEMPLATES_UPDATED',
        entityType: 'Settings',
        entityId: organizationId,
        details: { keys: [...Object.keys(incoming.en), ...Object.keys(incoming.ar)] }
      })
      return saved
    })
    res.json({ success: true, data: { templates: storedWhatsappTemplates(settings.data), keys: WHATSAPP_TEMPLATE_KEYS }, message: 'WhatsApp templates saved' })
  } catch (error) {
    next(error)
  }
})

// Package 20: read-only role matrix. Managers/admins can review effective
// permissions; the UI renders the same matrix bilingually.
router.get('/permissions', async (req, res, next) => {
  try {
    requireAnyRole(req, MANAGEMENT_ROLES)
    res.json({ success: true, data: permissionMatrix() })
  } catch (error) {
    next(error)
  }
})

router.get('/exchange-rates', async (req, res, next) => {
  try {
    requireAnyRole(req, FINANCE_ROLES)
    const data = await listExchangeRatesForOrg(organizationIdOf(req))
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

router.post('/exchange-rates/currencies', async (req, res, next) => {
  try {
    requireAnyRole(req, FINANCE_ROLES)
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const code = requiredString(req.body?.code, 'code', 3).toUpperCase()
    if (!/^[A-Z]{3}$/.test(code)) throw createError('code must be a 3-letter ISO currency code', 400)
    const name = optionalString(req.body?.name, 'name', 100) || code
    const symbol = optionalString(req.body?.symbol, 'symbol', 10) || code
    const decimals = Math.trunc(numberValue(req.body?.decimals, 'decimals', { min: 0, max: 6 }) ?? 2)
    const isEnabled = booleanValue(req.body?.isEnabled, 'isEnabled', true)
    const currency = await prisma.$transaction(async (tx) => {
      const saved = await upsertCurrencyRecord(tx, organizationId, code, { name, symbol, decimals, isEnabled })
      await logAudit(tx, { userId, action: 'CURRENCY_UPSERTED', entityType: 'Currency', entityId: saved.id, details: { code, name, symbol, decimals, isEnabled } })
      return saved
    })
    res.status(201).json({ success: true, data: currency })
  } catch (error) {
    next(error)
  }
})

router.post('/exchange-rates', async (req, res, next) => {
  try {
    requireAnyRole(req, FINANCE_ROLES)
    const organizationId = organizationIdOf(req)
    const userId = userIdOf(req)
    const fromCode = requiredString(req.body?.fromCurrency ?? req.body?.from, 'fromCurrency', 3).toUpperCase()
    const toCode = requiredString(req.body?.toCurrency ?? req.body?.to, 'toCurrency', 3).toUpperCase()
    if (!/^[A-Z]{3}$/.test(fromCode) || !/^[A-Z]{3}$/.test(toCode)) throw createError('Currency codes must be 3 letters', 400)
    if (fromCode === toCode) throw createError('fromCurrency and toCurrency must be different', 400)
    const rate = parseRate(req.body?.rate, 'rate')
    if (!rate) throw createError('rate is required', 400)
    const effectiveAt = dateValue(req.body?.effectiveAt, 'effectiveAt') || new Date()
    const note = optionalString(req.body?.note, 'note', 500)
    const fromCurrency = await resolveCurrency(organizationId, fromCode)
    const toCurrency = await resolveCurrency(organizationId, toCode)
    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.exchangeRate.create({
        data: { organizationId, fromCurrencyId: fromCurrency.id, toCurrencyId: toCurrency.id, rate, effectiveAt, note },
        include: {
          fromCurrency: { select: { id: true, code: true, name: true, symbol: true } },
          toCurrency: { select: { id: true, code: true, name: true, symbol: true } }
        }
      })
      await logAudit(tx, { userId, action: 'EXCHANGE_RATE_UPSERTED', entityType: 'ExchangeRate', entityId: created.id, details: { fromCurrency: fromCode, toCurrency: toCode, rate, effectiveAt: effectiveAt.toISOString() } })
      return created
    })
    res.status(201).json({ success: true, data: record })
  } catch (error) {
    next(error)
  }
})

export default router
