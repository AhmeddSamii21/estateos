-- Package 14 (floorplans/brochures) and Package 15 (lead priority).
-- Strictly additive: existing document rows keep OTHER and existing leads keep
-- their current values; no data is rewritten or removed.

-- CreateEnum
CREATE TYPE "PropertyAttachmentKind" AS ENUM ('OTHER', 'FLOORPLAN', 'BROCHURE');
CREATE TYPE "LeadPriorityTier" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "PropertyDocument" ADD COLUMN     "kind" "PropertyAttachmentKind" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "originalName" TEXT,
ADD COLUMN     "size" INTEGER,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "priorityScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "priorityTier" "LeadPriorityTier" NOT NULL DEFAULT 'MEDIUM';

-- CreateIndex
CREATE INDEX "PropertyDocument_propertyId_deletedAt_idx" ON "PropertyDocument"("propertyId", "deletedAt");
CREATE INDEX "PropertyDocument_propertyId_kind_idx" ON "PropertyDocument"("propertyId", "kind");
CREATE INDEX "Lead_priorityScore_idx" ON "Lead"("priorityScore");
CREATE INDEX "Lead_priorityTier_idx" ON "Lead"("priorityTier");
CREATE INDEX "Lead_source_idx" ON "Lead"("source");
