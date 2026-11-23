import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

// Keep one PrismaClient per process instead of instantiating one per request.
// Reuse the instance across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
