import { Prisma, PropertyType } from '@prisma/client'

export interface LeadMatchCriteria {
  budgetMin: Prisma.Decimal | string | number | null
  budgetMax: Prisma.Decimal | string | number | null
  preferredType: PropertyType | null
  preferredCity: string | null
  preferredBedrooms: number | null
  preferredAreaMin: Prisma.Decimal | string | number | null
  preferredAreaMax: Prisma.Decimal | string | number | null
}

export interface LeadMatchProperty {
  type: PropertyType
  city: string | null
  state: string | null
  country: string | null
  address: string | null
  bedrooms: number
  area: Prisma.Decimal | string | number | null
  price: Prisma.Decimal | string | number
}

function toNumber(value: Prisma.Decimal | string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value.toString())
  return Number.isFinite(parsed) ? parsed : null
}

export function scoreLeadPropertyMatch(lead: LeadMatchCriteria, property: LeadMatchProperty) {
  const reasons: string[] = []
  let score = 0
  let criteria = 0

  const budgetMin = toNumber(lead.budgetMin)
  const budgetMax = toNumber(lead.budgetMax)
  const price = toNumber(property.price) ?? 0
  if (budgetMin !== null || budgetMax !== null) {
    criteria += 1
    const minOk = budgetMin === null || price >= budgetMin
    const maxOk = budgetMax === null || price <= budgetMax
    if (minOk && maxOk) { score += 3; reasons.push('Budget fit') }
    else {
      const edge = budgetMax ?? budgetMin ?? price
      const distance = edge > 0 ? Math.abs(price - edge) / edge : 1
      if (distance <= 0.1) { score += 1; reasons.push('Near budget') } else { score -= 2 }
    }
  }

  if (lead.preferredType) {
    criteria += 1
    if (property.type === lead.preferredType) { score += 2; reasons.push('Property type match') } else { score -= 1 }
  }

  const preferredCity = lead.preferredCity?.trim().toLowerCase()
  if (preferredCity) {
    criteria += 1
    const haystack = [property.city, property.state, property.country, property.address]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .join(' ')
      .toLowerCase()
    if (haystack.includes(preferredCity)) { score += 2; reasons.push('Location match') } else { score -= 1 }
  }

  if (lead.preferredBedrooms !== null) {
    criteria += 1
    if (property.bedrooms === lead.preferredBedrooms) { score += 2; reasons.push('Bedroom match') }
    else if (Math.abs(property.bedrooms - lead.preferredBedrooms) === 1) { score += 1; reasons.push('Near bedroom count') }
    else { score -= 1 }
  }

  const areaMin = toNumber(lead.preferredAreaMin)
  const areaMax = toNumber(lead.preferredAreaMax)
  const area = toNumber(property.area)
  if (areaMin !== null || areaMax !== null) {
    criteria += 1
    if (area !== null && (areaMin === null || area >= areaMin) && (areaMax === null || area <= areaMax)) { score += 2; reasons.push('Area fit') }
    else if (area !== null) { score -= 1 }
  }

  if (criteria === 0) { score = 1; reasons.push('Available property') }
  return { score, reasons, criteria }
}
