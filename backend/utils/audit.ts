import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'

export type AuditClient = Prisma.TransactionClient | typeof prisma

export async function logAudit(
  client: AuditClient,
  params: { userId?: string | null; action: string; entityType: string; entityId?: string | null; details?: Record<string, unknown> }
): Promise<void> {
  await client.auditLog.create({
    data: {
      userId: params.userId || null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId || null,
      details: params.details ? JSON.stringify(params.details) : null
    }
  })
}

export async function logPropertyActivity(
  client: AuditClient,
  params: { propertyId: string; userId?: string | null; action: string; details?: Record<string, unknown> }
): Promise<void> {
  await client.propertyActivity.create({
    data: {
      propertyId: params.propertyId,
      userId: params.userId || null,
      action: params.action,
      details: params.details ? JSON.stringify(params.details) : null
    }
  })
}
