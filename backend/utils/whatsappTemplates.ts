import { createError } from '../middleware/errorHandler'

/**
 * Package 26: organization-level overrides for the built-in WhatsApp
 * templates. Templates are stored inside Settings.data.whatsappTemplates so
 * no schema change is needed and existing settings rows keep their data.
 */
export const WHATSAPP_TEMPLATE_KEYS = [
  'propertyShare',
  'appointmentConfirmation',
  'appointmentReminder',
  'installmentReminder',
  'leadFollowUp'
] as const

export type WhatsAppTemplateKey = (typeof WHATSAPP_TEMPLATE_KEYS)[number]
export type WhatsAppTemplateLanguage = 'en' | 'ar'
export type WhatsAppTemplateMap = Partial<Record<WhatsAppTemplateKey, string>>
export type StoredWhatsappTemplates = Record<WhatsAppTemplateLanguage, WhatsAppTemplateMap>

export const EMPTY_WHATSAPP_TEMPLATES: StoredWhatsappTemplates = { en: {}, ar: {} }

/** Only public listing/payment fields may appear in a custom template. */
export const WHATSAPP_TEMPLATE_PLACEHOLDERS = [
  'title',
  'reference',
  'price',
  'currency',
  'city',
  'address',
  'bedrooms',
  'bathrooms',
  'area',
  'areaUnit',
  'link',
  'token',
  'origin',
  'customerName',
  'startsAt',
  'location',
  'dueDate',
  'amount',
  'remainingBalance'
] as const

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeLanguageMap(value: unknown, language: WhatsAppTemplateLanguage): WhatsAppTemplateMap {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) throw createError(`whatsappTemplates.${language} must be an object`, 400)
  const result: WhatsAppTemplateMap = {}
  for (const [key, template] of Object.entries(value)) {
    if (!(WHATSAPP_TEMPLATE_KEYS as readonly string[]).includes(key)) {
      throw createError(`Unsupported WhatsApp template key: ${key}`, 400)
    }
    if (template === null || template === '') continue
    if (typeof template !== 'string') throw createError(`whatsappTemplates.${language}.${key} must be a string`, 400)
    if (template.length > 2000) throw createError(`whatsappTemplates.${language}.${key} is too long`, 400)
    // Only explicit public fields are allowed; nested paths could resolve
    // internal notes if a payload ever carried them.
    for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
      if (!(WHATSAPP_TEMPLATE_PLACEHOLDERS as readonly string[]).includes(match[1])) {
        throw createError(`Unsupported WhatsApp placeholder: ${match[1]}`, 400)
      }
    }
    const leftovers = template.replace(PLACEHOLDER_PATTERN, '')
    if (leftovers.includes('{{') || leftovers.includes('}}')) {
      throw createError(`whatsappTemplates.${language}.${key} has an invalid placeholder`, 400)
    }
    result[key as WhatsAppTemplateKey] = template
  }
  return result
}

export function sanitizeWhatsappTemplates(input: unknown): StoredWhatsappTemplates {
  if (input === undefined || input === null) return { en: {}, ar: {} }
  if (!isRecord(input)) throw createError('whatsappTemplates must be an object', 400)
  const unknownKeys = Object.keys(input).filter((key) => key !== 'en' && key !== 'ar')
  if (unknownKeys.length) throw createError(`Unsupported WhatsApp template language: ${unknownKeys[0]}`, 400)
  return {
    en: sanitizeLanguageMap(input.en, 'en'),
    ar: sanitizeLanguageMap(input.ar, 'ar')
  }
}

export function storedWhatsappTemplates(data: unknown): StoredWhatsappTemplates {
  if (!isRecord(data)) return { en: {}, ar: {} }
  try {
    return sanitizeWhatsappTemplates(data.whatsappTemplates)
  } catch {
    // A malformed legacy settings blob must never break the settings screen.
    return { en: {}, ar: {} }
  }
}
