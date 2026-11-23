-- Package 6: lead follow-up notes/reminders and rental lease tracking.
-- Generated with: prisma migrate diff --from-url <DATABASE_URL> --to-schema-datamodel prisma/schema.prisma --script
-- (no shadow database required; estateos_app lacks CREATEDB).

-- AlterTable
ALTER TABLE "Currency" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "leaseEndAt" TIMESTAMP(3),
ADD COLUMN     "leaseStartAt" TIMESTAMP(3),
ADD COLUMN     "renewalNoticeDays" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "lastContactedAt" TIMESTAMP(3),
ADD COLUMN     "nextFollowUpAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "nextFollowUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadNote_leadId_createdAt_idx" ON "LeadNote"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadNote_authorId_idx" ON "LeadNote"("authorId");

-- CreateIndex
CREATE INDEX "Deal_type_leaseEndAt_idx" ON "Deal"("type", "leaseEndAt");

-- CreateIndex
CREATE INDEX "Lead_nextFollowUpAt_idx" ON "Lead"("nextFollowUpAt");

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

