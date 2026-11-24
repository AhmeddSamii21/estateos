-- Package 16 (deal closing checklist) and Package 17 (payment aging).
-- Strictly additive: existing deals stay unchanged and aging is computed from
-- existing due/paid dates, so no historical payment data is rewritten.

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "checklistOverrideReason" TEXT,
ADD COLUMN     "checklistOverriddenById" TEXT,
ADD COLUMN     "checklistOverriddenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DealClosingChecklist" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealClosingChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DealClosingChecklist_dealId_itemKey_key" ON "DealClosingChecklist"("dealId", "itemKey");
CREATE INDEX "DealClosingChecklist_organizationId_idx" ON "DealClosingChecklist"("organizationId");
CREATE INDEX "DealClosingChecklist_dealId_idx" ON "DealClosingChecklist"("dealId");

-- AddForeignKey
ALTER TABLE "DealClosingChecklist" ADD CONSTRAINT "DealClosingChecklist_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
