// Package 39: pure white-label helpers shared by the Vue UI and Node tests.

export const BRANDING_DEFAULTS = Object.freeze({
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
  theme: 'LIGHT',
  isActive: true
})

export function mergeBranding(branding = {}) {
  return { ...BRANDING_DEFAULTS, ...branding }
}

export function safeBrandUrl(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || value.length > 500) return null
  const trimmed = value.trim()
  if (/^\/[^\/]/.test(trimmed)) return trimmed
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : null
  } catch {
    return null
  }
}

export function brandingCssVariables(branding = {}) {
  const value = mergeBranding(branding)
  return {
    '--brand-primary': value.primaryColor,
    '--brand-secondary': value.secondaryColor,
    '--brand-accent': value.accentColor,
    '--brand-background': value.theme === 'DARK' ? '#0F172A' : '#FFFFFF',
    '--brand-foreground': value.theme === 'DARK' ? '#F8FAFC' : '#0F172A'
  }
}

export function brandingDirection(branding = {}, language = 'en') {
  if (language === 'ar') return 'rtl'
  return branding?.brandNameAr && !branding?.brandName ? 'rtl' : 'ltr'
}

export function displayBrandName(branding = {}, organizationName = 'EstateOS', language = 'en') {
  const value = mergeBranding(branding)
  if (language === 'ar') return value.brandNameAr || value.brandName || organizationName
  return value.brandName || organizationName
}
