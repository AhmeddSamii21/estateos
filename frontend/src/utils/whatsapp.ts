/**
 * EstateOS Package 26 — bilingual WhatsApp click-to-chat helper (frontend API).
 *
 * The pure implementation lives in `whatsappCore.mjs` so the same tested code
 * can be imported by Vite and by the Node test runner. This module is the
 * typed entry point used by Vue views.
 */

export {
  renderWhatsAppTemplate,
  buildWhatsAppTemplate,
  normalizeWhatsAppPhone,
  buildWhatsAppUrl,
  buildWhatsAppMessageLink,
  propertySharePath
} from './whatsappCore.mjs'

export type {
  WhatsAppLanguage,
  WhatsAppTemplateKey,
  WhatsAppTemplatePayload,
  WhatsAppTemplateOverrides,
  RenderedWhatsAppMessage
} from './whatsappCore.mjs'

import { buildWhatsAppMessageLink } from './whatsappCore.mjs'
import type {
  WhatsAppLanguage,
  WhatsAppTemplateKey,
  WhatsAppTemplateOverrides,
  WhatsAppTemplatePayload
} from './whatsappCore.mjs'

const OVERRIDES_KEY = 'estateos.whatsappTemplates'

/** SettingsView caches the organization's optional bilingual template overrides here. */
export function cacheWhatsAppOverrides(overrides: WhatsAppTemplateOverrides): void {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides))
  } catch {
    // Private browsing / disabled storage: built-in templates still work.
  }
}

export function resolveWhatsAppOverrides(language: WhatsAppLanguage): WhatsAppTemplateOverrides | undefined {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Record<string, { en?: string; ar?: string }>
    const result: WhatsAppTemplateOverrides = {}
    for (const [key, value] of Object.entries(parsed || {})) {
      if (value && typeof value[language] === 'string') {
        (result as Record<string, string>)[key] = value[language] as string
      }
    }
    return result
  } catch {
    return undefined
  }
}

/** Open wa.me with the localized pre-filled message; returns false for bad numbers. */
export function openWhatsAppChat(options: {
  phone: unknown
  template: WhatsAppTemplateKey
  payload: WhatsAppTemplatePayload
  language?: WhatsAppLanguage
}): boolean {
  const language = options.language || 'en'
  const url = buildWhatsAppMessageLink({
    phone: options.phone,
    template: options.template,
    payload: options.payload,
    language,
    overrides: resolveWhatsAppOverrides(language)
  })
  if (!url || typeof window === 'undefined') return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}
