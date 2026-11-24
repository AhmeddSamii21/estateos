import { BrandingTheme } from '@prisma/client'
import { createError } from '../middleware/errorHandler'

export interface BrandingRecord {
  brandName: string | null
  brandNameAr: string | null
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string
  secondaryColor: string
  accentColor: string
  supportEmail: string | null
  supportPhone: string | null
  footerText: string | null
  footerTextAr: string | null
  theme: BrandingTheme
  isActive: boolean
  updatedAt?: Date
}

export const DEFAULT_BRANDING: BrandingRecord = {
  brandName: null,
  brandNameAr: null,
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#2563EB',
  secondaryColor: '#0F172A',
  accentColor: '#14B8A6',
  supportEmail: null,
  supportPhone: null,
  footerText: null,
  footerTextAr: null,
  theme: BrandingTheme.LIGHT,
  isActive: true
}

/** Only http(s) absolute URLs and single-slash local paths are safe for images. */
export function safeBrandUrl(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || value.length > 500) throw createError(`${field} must be a URL under 500 characters`, 400)
  const trimmed = value.trim()
  if (/^\/[^\/]/.test(trimmed)) return trimmed
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsafe protocol')
    return trimmed
  } catch {
    throw createError(`${field} must be an http(s) URL or a local path`, 400)
  }
}

export function brandColor(value: unknown, field: string, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string' || !/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value.trim())) {
    throw createError(`${field} must be a hex color such as #2563EB`, 400)
  }
  const hex = value.trim()
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toUpperCase()
  }
  return hex.toUpperCase()
}

export function brandingResponse(row: BrandingRecord | null, organization: { name: string; logoUrl: string | null; email: string | null; phone: string | null }): BrandingRecord & {
  displayName: string
  displayNameAr: string
  direction: 'ltr' | 'rtl'
} {
  const branding = { ...DEFAULT_BRANDING, ...(row || {}) }
  return {
    ...branding,
    displayName: branding.brandName || organization.name,
    displayNameAr: branding.brandNameAr || branding.brandName || organization.name,
    logoUrl: branding.logoUrl || organization.logoUrl,
    supportEmail: branding.supportEmail || organization.email,
    supportPhone: branding.supportPhone || organization.phone,
    direction: branding.footerTextAr || branding.brandNameAr ? 'rtl' : 'ltr'
  }
}
