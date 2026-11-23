import { Prisma, PropertyType, PropertyStatus, Role } from '@prisma/client'
import { createError } from '../middleware/errorHandler'
import { booleanValue, enumValue, numberValue, optionalString } from './validation'
import { parseMoney } from './money'
import { leadScope, ownerReadScope } from './scope'

export interface PropertySearchFilters {
  keyword?: string
  search?: string
  type?: string
  status?: string
  city?: string
  country?: string
  currency?: string
  minPrice?: string
  maxPrice?: string
  bedrooms?: string
  bathrooms?: string
  minArea?: string
  maxArea?: string
  assignedAgentId?: string
  availability?: 'available' | 'unavailable'
  featured?: string | boolean
  minLatitude?: string
  maxLatitude?: string
  minLongitude?: string
  maxLongitude?: string
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'area_desc'
}

export interface ParsedPropertySearch {
  where: Prisma.PropertyWhereInput
  orderBy: Prisma.PropertyOrderByWithRelationInput
}

const SORT_MAP: Record<NonNullable<PropertySearchFilters['sort']>, Prisma.PropertyOrderByWithRelationInput> = {
  newest: { createdAt: 'desc' },
  price_asc: { price: 'asc' },
  price_desc: { price: 'desc' },
  area_desc: { area: 'desc' }
}

export function buildPropertySearch(filters: PropertySearchFilters, organizationId: string): ParsedPropertySearch {
  const where: Prisma.PropertyWhereInput = {
    organizationId,
    isActive: true,
    deletedAt: null
  }

  const keyword = optionalString(filters.keyword || filters.search, 'keyword', 200)
  if (keyword) {
    where.OR = [
      { title: { contains: keyword, mode: 'insensitive' } },
      { referenceNumber: { contains: keyword, mode: 'insensitive' } },
      { city: { contains: keyword, mode: 'insensitive' } },
      { address: { contains: keyword, mode: 'insensitive' } },
      { description: { contains: keyword, mode: 'insensitive' } }
    ]
  }
  if (filters.type) where.type = enumValue(filters.type, 'type', Object.values(PropertyType))
  if (filters.status) where.status = enumValue(filters.status, 'status', Object.values(PropertyStatus))
  const city = optionalString(filters.city, 'city', 120)
  if (city) where.city = { contains: city, mode: 'insensitive' }
  const country = optionalString(filters.country, 'country', 120)
  if (country) where.country = { contains: country, mode: 'insensitive' }
  const currency = optionalString(filters.currency, 'currency', 3)
  if (currency) where.currency = currency.toUpperCase()

  const minPrice = parseMoney(filters.minPrice, 'minPrice')
  const maxPrice = parseMoney(filters.maxPrice, 'maxPrice')
  if (minPrice || maxPrice) {
    where.price = { ...(minPrice ? { gte: minPrice } : {}), ...(maxPrice ? { lte: maxPrice } : {}) }
  }

  const bedrooms = numberValue(filters.bedrooms, 'bedrooms', { min: 0 })
  const bathrooms = numberValue(filters.bathrooms, 'bathrooms', { min: 0 })
  if (bedrooms !== undefined) where.bedrooms = { gte: bedrooms }
  if (bathrooms !== undefined) where.bathrooms = { gte: bathrooms }

  const minArea = numberValue(filters.minArea, 'minArea', { min: 0 })
  const maxArea = numberValue(filters.maxArea, 'maxArea', { min: 0 })
  if (minArea !== undefined || maxArea !== undefined) {
    where.area = { ...(minArea !== undefined ? { gte: minArea } : {}), ...(maxArea !== undefined ? { lte: maxArea } : {}) }
  }

  const minLatitude = numberValue(filters.minLatitude, 'minLatitude', { min: -90, max: 90 })
  const maxLatitude = numberValue(filters.maxLatitude, 'maxLatitude', { min: -90, max: 90 })
  const minLongitude = numberValue(filters.minLongitude, 'minLongitude', { min: -180, max: 180 })
  const maxLongitude = numberValue(filters.maxLongitude, 'maxLongitude', { min: -180, max: 180 })
  if (minLatitude !== undefined || maxLatitude !== undefined) {
    where.latitude = { ...(minLatitude !== undefined ? { gte: minLatitude } : {}), ...(maxLatitude !== undefined ? { lte: maxLatitude } : {}) }
  }
  if (minLongitude !== undefined || maxLongitude !== undefined) {
    where.longitude = { ...(minLongitude !== undefined ? { gte: minLongitude } : {}), ...(maxLongitude !== undefined ? { lte: maxLongitude } : {}) }
  }

  const assignedAgentId = optionalString(filters.assignedAgentId, 'assignedAgentId', 100)
  if (assignedAgentId) where.assignedAgentId = assignedAgentId
  if (filters.featured !== undefined) where.featured = booleanValue(filters.featured, 'featured')
  if (filters.availability === 'available') where.status = PropertyStatus.AVAILABLE
  if (filters.availability === 'unavailable') where.status = { not: PropertyStatus.AVAILABLE }
  if (filters.availability && !['available', 'unavailable'].includes(filters.availability)) {
    // Retain validation failure semantics for bad client input.
    throw createError('availability must be available or unavailable', 400)
  }

  const orderBy = SORT_MAP[filters.sort || 'newest'] || SORT_MAP.newest
  return { where, orderBy }
}

// Global search response types
export interface SearchResult<T = Record<string, unknown>> {
  id: string
  title: string
  type: string
  route: string
  details?: T
}

export interface GlobalSearchResponse {
  success: boolean
  data: {
    properties: SearchResult[]
    owners: SearchResult<{ name: string; email?: string; phone?: string }>[]
    leads: SearchResult<{ name: string; email?: string; phone?: string }>[]
    deals: SearchResult<{ referenceNumber?: string; property?: string; amount?: string }>[]
    documents: SearchResult<{ name: string; category?: string }>[]
    total: number
  }
  error?: string
}

export interface GlobalSearchFilters {
  q: string
  limit?: number
}

export interface GlobalSearchViewer {
  id: string
  role: Role
}

export const GLOBAL_PROPERTY_SELECT = {
  id: true,
  title: true,
  city: true,
  address: true,
  price: true,
  referenceNumber: true,
  type: true
} satisfies Prisma.PropertySelect

export const GLOBAL_OWNER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  companyName: true,
  email: true,
  phone: true
} satisfies Prisma.OwnerSelect

export const GLOBAL_LEAD_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  status: true
} satisfies Prisma.LeadSelect

export const GLOBAL_DEAL_SELECT = {
  id: true,
  referenceNumber: true,
  amount: true,
  status: true,
  type: true
} satisfies Prisma.DealSelect

export const GLOBAL_DOCUMENT_SELECT = {
  id: true,
  name: true,
  category: true,
  originalName: true
} satisfies Prisma.DocumentSelect

export interface GlobalSearchQuery {
  properties: {
    where: Prisma.PropertyWhereInput
    select: typeof GLOBAL_PROPERTY_SELECT
    orderBy: Prisma.PropertyOrderByWithRelationInput[]
  }
  owners: {
    where: Prisma.OwnerWhereInput
    select: typeof GLOBAL_OWNER_SELECT
    orderBy: Prisma.OwnerOrderByWithRelationInput[]
  }
  leads: {
    where: Prisma.LeadWhereInput
    select: typeof GLOBAL_LEAD_SELECT
    orderBy: Prisma.LeadOrderByWithRelationInput[]
  }
  deals: {
    where: Prisma.DealWhereInput
    select: typeof GLOBAL_DEAL_SELECT
    orderBy: Prisma.DealOrderByWithRelationInput[]
  }
  documents: {
    where: Prisma.DocumentWhereInput
    select: typeof GLOBAL_DOCUMENT_SELECT
    orderBy: Prisma.DocumentOrderByWithRelationInput[]
  }
}

/**
 * Builds tenant-scoped, role-scoped, deterministic search queries. Lead and
 * owner scoping mirrors their own modules because those models do not carry a
 * required organizationId on every row.
 */
export function buildGlobalSearchQuery(
  organizationId: string,
  query: string,
  viewer: GlobalSearchViewer
): GlobalSearchQuery {
  const q = query.trim()
  const isAgent = viewer.role === Role.AGENT

  const propertyBase: Prisma.PropertyWhereInput = {
    organizationId,
    isActive: true,
    deletedAt: null,
    ...(isAgent ? { assignedAgentId: viewer.id } : {})
  }
  const ownerBase: Prisma.OwnerWhereInput = {
    isActive: true,
    deletedAt: null,
    ...ownerReadScope(organizationId)
  }
  const leadBase: Prisma.LeadWhereInput = {
    isActive: true,
    deletedAt: null,
    ...leadScope(organizationId),
    ...(isAgent ? { assignedToId: viewer.id } : {})
  }
  const dealBase: Prisma.DealWhereInput = {
    organizationId,
    deletedAt: null,
    ...(isAgent ? { userId: viewer.id } : {})
  }
  const documentBase: Prisma.DocumentWhereInput = {
    organizationId,
    status: 'ACTIVE',
    deletedAt: null
  }
  const documentAccess: Prisma.DocumentWhereInput[] = isAgent
    ? [{
        OR: [
          { uploadedById: viewer.id },
          { property: { assignedAgentId: viewer.id } },
          { deal: { userId: viewer.id } },
          { lead: { assignedToId: viewer.id } }
        ]
      }]
    : []

  const propertyText: Prisma.PropertyWhereInput[] = q
    ? [
        { title: { contains: q, mode: 'insensitive' } },
        { referenceNumber: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } }
      ]
    : []
  const ownerText: Prisma.OwnerWhereInput[] = q
    ? [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } }
      ]
    : []
  const leadText: Prisma.LeadWhereInput[] = q
    ? [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } }
      ]
    : []
  const dealText: Prisma.DealWhereInput[] = q
    ? [
        { referenceNumber: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
        { property: { title: { contains: q, mode: 'insensitive' } } }
      ]
    : []
  const documentText: Prisma.DocumentWhereInput[] = q
    ? [
        { name: { contains: q, mode: 'insensitive' } },
        { originalName: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } }
      ]
    : []

  const documentWhere: Prisma.DocumentWhereInput = documentAccess.length || documentText.length
    ? { ...documentBase, AND: [...documentAccess, ...(documentText.length ? [{ OR: documentText }] : [])] }
    : documentBase

  return {
    properties: {
      where: propertyText.length ? { ...propertyBase, OR: propertyText } : propertyBase,
      select: GLOBAL_PROPERTY_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    },
    owners: {
      where: ownerText.length ? { ...ownerBase, AND: [{ OR: ownerText }] } : ownerBase,
      select: GLOBAL_OWNER_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    },
    leads: {
      where: leadText.length ? { ...leadBase, AND: [{ OR: leadText }] } : leadBase,
      select: GLOBAL_LEAD_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    },
    deals: {
      where: dealText.length ? { ...dealBase, OR: dealText } : dealBase,
      select: GLOBAL_DEAL_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    },
    documents: {
      where: documentWhere,
      select: GLOBAL_DOCUMENT_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    }
  }
}
