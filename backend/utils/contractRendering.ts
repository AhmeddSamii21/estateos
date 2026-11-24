import type { ContractTemplate } from '@prisma/client'

export const CONTRACT_TOKENS = [
  'client_name',
  'property_title',
  'property_city',
  'property_area',
  'deal_reference',
  'deal_amount',
  'deal_currency',
  'agent_name',
  'organization_name',
  'today'
] as const

const TOKEN_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g

export function renderContractText(text: string, values: Record<string, unknown>): string {
  return text.replace(TOKEN_PATTERN, (_match, token: string) => {
    if (!CONTRACT_TOKENS.includes(token as (typeof CONTRACT_TOKENS)[number])) return `{{${token}}}`
    const value = values[token]
    return value === undefined || value === null || value === '' ? '—' : String(value)
  })
}

export function missingContractTokens(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN_PATTERN)].map((match) => match[1]))]
    .filter((token) => !CONTRACT_TOKENS.includes(token as (typeof CONTRACT_TOKENS)[number]))
    .sort()
}

export function selectContractBody(template: Pick<ContractTemplate, 'body' | 'bodyAr'>, language: 'en' | 'ar'): string {
  return language === 'ar' ? (template.bodyAr || template.body) : template.body
}

export function buildContractPreview(
  template: Pick<ContractTemplate, 'name' | 'nameAr' | 'body' | 'bodyAr'>,
  values: Record<string, unknown>,
  language: 'en' | 'ar'
) {
  const body = renderContractText(selectContractBody(template, language), values)
  return {
    title: language === 'ar' ? (template.nameAr || template.name) : template.name,
    body,
    language,
    direction: language === 'ar' ? 'rtl' : 'ltr',
    missingTokens: missingContractTokens(body),
    hasArabicBody: Boolean(template.bodyAr)
  }
}
