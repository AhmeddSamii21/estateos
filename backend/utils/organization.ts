import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { createError } from '../middleware/errorHandler'

export const DEFAULT_ORG_SLUG = 'estateos'

export async function resolveOrganization(organizationId?: string) {
  if (organizationId) {
    const organization = await prisma.organization.findFirst({
      where: { id: organizationId, isActive: true, deletedAt: null }
    })
    if (!organization) throw createError('Organization not found or inactive', 404)
    return organization
  }

  const existing = await prisma.organization.findFirst({
    where: { slug: DEFAULT_ORG_SLUG, isActive: true, deletedAt: null }
  })
  if (existing) return existing

  try {
    return await prisma.organization.create({
      data: {
        name: process.env.COMPANY_NAME || 'EstateOS',
        slug: DEFAULT_ORG_SLUG,
        currency: process.env.DEFAULT_CURRENCY || 'USD',
        baseCurrency: process.env.DEFAULT_CURRENCY || 'USD'
      }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await prisma.organization.findFirst({
        where: { slug: DEFAULT_ORG_SLUG, isActive: true, deletedAt: null }
      })
      if (raced) return raced
    }
    throw error
  }
}
