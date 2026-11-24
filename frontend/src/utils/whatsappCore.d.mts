export type WhatsAppLanguage = 'en' | 'ar'
export type WhatsAppTemplateKey =
  | 'propertyShare'
  | 'appointmentConfirmation'
  | 'appointmentReminder'
  | 'installmentReminder'
  | 'leadFollowUp'

export interface WhatsAppTemplatePayload {
  title?: string | number | null
  reference?: string | number | null
  price?: string | number | null
  currency?: string | null
  city?: string | null
  address?: string | null
  bedrooms?: string | number | null
  bathrooms?: string | number | null
  area?: string | number | null
  areaUnit?: string | null
  link?: string | null
  token?: string | null
  origin?: string | null
  startsAt?: string | Date | null
  endsAt?: string | Date | null
  dueDate?: string | Date | null
  amount?: string | number | null
  remainingBalance?: string | number | null
  customerName?: string | null
  location?: string | null
  notes?: string | null
  [key: string]: unknown
}

export type WhatsAppTemplateOverrides = Partial<Record<WhatsAppTemplateKey, string>>

export interface RenderedWhatsAppMessage {
  language: WhatsAppLanguage
  template: WhatsAppTemplateKey
  text: string
}

export function renderWhatsAppTemplate(template: string, payload?: WhatsAppTemplatePayload): string
export function buildWhatsAppTemplate(
  key: WhatsAppTemplateKey,
  payload: WhatsAppTemplatePayload,
  language?: WhatsAppLanguage,
  overrides?: WhatsAppTemplateOverrides
): RenderedWhatsAppMessage
export function normalizeWhatsAppPhone(raw: unknown): string | null
export function buildWhatsAppUrl(phone: unknown, message: string): string | null
export function buildWhatsAppMessageLink(options: {
  phone: unknown
  template: WhatsAppTemplateKey
  payload?: WhatsAppTemplatePayload
  language?: WhatsAppLanguage
  overrides?: WhatsAppTemplateOverrides
}): string | null
export function propertySharePath(token: string, origin?: string | null): string
