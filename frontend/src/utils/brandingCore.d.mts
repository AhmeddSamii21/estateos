export interface BrandingLike {
  brandName?: string | null
  brandNameAr?: string | null
  logoUrl?: string | null
  faviconUrl?: string | null
  primaryColor?: string
  secondaryColor?: string
  accentColor?: string
  supportEmail?: string | null
  supportPhone?: string | null
  footerText?: string | null
  footerTextAr?: string | null
  theme?: string
  isActive?: boolean
}

export declare const BRANDING_DEFAULTS: Readonly<Record<string, unknown>>

export declare function mergeBranding(branding?: BrandingLike | null): BrandingLike
export declare function safeBrandUrl(value: unknown): string | null
export declare function brandingCssVariables(branding?: BrandingLike | null): Record<string, string>
export declare function brandingDirection(branding?: BrandingLike | null, language?: string): 'ltr' | 'rtl'
export declare function displayBrandName(branding?: BrandingLike | null, organizationName?: string, language?: string): string
