-- Package 18 (owner payout settlement and recurring maintenance).
-- Strictly additive: existing maintenance rows keep NONE/nullable recurrence
-- values, and payouts are recorded without rewriting statement data.

-- CreateEnum
CREATE TYPE "MaintenanceRecurrenceInterval" AS ENUM ('NONE', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL');
CREATE TYPE "OwnerPayoutStatus" AS ENUM ('PENDING', 'SETTLED', 'CANCELLED');

-- AlterTable
ALTER TABLE "MaintenanceRequest"
ADD COLUMN     "recurrenceInterval" "MaintenanceRecurrenceInterval" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "nextDueAt" TIMESTAMP(3),
ADD COLUMN     "recurrenceSourceId" TEXT;

-- CreateTable
CREATE TABLE "OwnerPayout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "OwnerPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "notes" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "settledById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "OwnerPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceRequest_nextDueAt_idx" ON "MaintenanceRequest"("nextDueAt");
CREATE INDEX "MaintenanceRequest_recurrenceInterval_idx" ON "MaintenanceRequest"("recurrenceInterval");
CREATE INDEX "OwnerPayout_organizationId_idx" ON "OwnerPayout"("organizationId");
CREATE INDEX "OwnerPayout_ownerId_status_idx" ON "OwnerPayout"("ownerId", "status");
CREATE INDEX "OwnerPayout_createdAt_idx" ON "OwnerPayout"("createdAt");

-- AddForeignKey
ALTER TABLE "OwnerPayout" ADD CONSTRAINT "OwnerPayout_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnerPayout" ADD CONSTRAINT "OwnerPayout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
