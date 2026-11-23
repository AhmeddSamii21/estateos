-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountStatus" "AccountStatus",
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "tokenVersion" INTEGER;

-- Backfill existing rows before enforcing NOT NULL.
-- Legacy inactive or deleted users keep the same effective access by becoming SUSPENDED.
-- "statusReason" is left NULL for existing rows because the column was added without a default.
UPDATE "User"
SET "accountStatus" = CASE
        WHEN "deletedAt" IS NOT NULL THEN 'SUSPENDED'::"AccountStatus"
        WHEN "isActive" = true AND "deletedAt" IS NULL THEN 'ACTIVE'::"AccountStatus"
        WHEN "isActive" = false AND "deletedAt" IS NULL THEN 'SUSPENDED'::"AccountStatus"
        ELSE 'SUSPENDED'::"AccountStatus"
    END,
    "tokenVersion" = 0;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "accountStatus" SET NOT NULL,
ALTER COLUMN "accountStatus" SET DEFAULT 'ACTIVE',
ALTER COLUMN "tokenVersion" SET NOT NULL,
ALTER COLUMN "tokenVersion" SET DEFAULT 0;

-- CreateIndex
CREATE INDEX "User_accountStatus_idx" ON "User"("accountStatus");
