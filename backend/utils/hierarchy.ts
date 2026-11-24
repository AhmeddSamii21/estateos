import { createError } from '../middleware/errorHandler'
import { prisma } from '../prisma'

/** Validates optional Package 27 grouping references inside one tenant. */
export async function assertHierarchyRefs(
  organizationId: string,
  branchId: string | undefined,
  teamId: string | undefined
): Promise<void> {
  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId, deletedAt: null },
      select: { id: true }
    })
    if (!branch) throw createError('Branch not found', 404)
  }
  if (teamId) {
    const team = await prisma.team.findFirst({
      where: { id: teamId, organizationId, deletedAt: null },
      select: { id: true, branchId: true }
    })
    if (!team) throw createError('Team not found', 404)
    if (branchId && team.branchId && team.branchId !== branchId) {
      throw createError('Team does not belong to the selected branch', 400)
    }
  }
}
