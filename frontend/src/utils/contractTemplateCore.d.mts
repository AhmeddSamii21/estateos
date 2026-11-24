export interface ContractValueContext {
  client_name: string
  property_title: string
  property_city: string
  property_area: string
  deal_reference: string
  deal_amount: string
  deal_currency: string
  agent_name: string
  organization_name: string
  today: string
}

export interface ContractTemplateSource {
  id?: string
  name?: string
  nameAr?: string | null
  body: string
  bodyAr?: string | null
  language?: 'EN' | 'AR' | 'BILINGUAL'
}

export interface ContractPreview {
  title: string
  body: string
  language: 'ar' | 'en'
  direction: 'ltr' | 'rtl'
  missingTokens: string[]
  hasArabicBody: boolean
}

export declare const CONTRACT_TOKENS: readonly string[]

export declare function missingContractTokens(text: string): string[]
export declare function renderContractText(text: string, values?: Record<string, unknown>): string
export declare function selectContractBody(template: ContractTemplateSource, language: 'ar' | 'en'): string
export declare function buildContractPreview(
  template: ContractTemplateSource,
  values?: Record<string, unknown>,
  language?: 'ar' | 'en'
): ContractPreview
export declare function contractValueContext(input?: {
  deal?: { id?: string; referenceNumber?: string | null; amount?: unknown; currency?: string } | null
  property?: { title?: string; city?: string | null; area?: unknown } | null
  lead?: { firstName?: string; lastName?: string | null } | null
  user?: { firstName?: string | null; lastName?: string | null; email?: string } | null
  organization?: { name?: string } | null
  today?: string
}): ContractValueContext
