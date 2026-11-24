-- Packages 41-42: follow-up automation rules/tasks and optional unit grid metadata.
-- Strictly additive: nullable columns are added to Property; nothing is removed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FollowUpTrigger') THEN
    CREATE TYPE "FollowUpTrigger" AS ENUM ('NEW_LEAD', 'NO_CONTACT', 'VIEWING_NO_DEAL', 'DEAL_STALLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FollowUpChannel') THEN
    CREATE TYPE "FollowUpChannel" AS ENUM ('NOTIFICATION', 'EMAIL', 'WHATSAPP');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FollowUpTaskStatus') THEN
    CREATE TYPE "FollowUpTaskStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');
  END IF;
END $$;

ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "projectName" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "buildingName" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "unitNumber" TEXT;

CREATE TABLE IF NOT EXISTS "FollowUpRule" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "trigger" "FollowUpTrigger" NOT NULL,
  "conditionDays" INTEGER NOT NULL DEFAULT 3,
  "channel" "FollowUpChannel" NOT NULL DEFAULT 'NOTIFICATION',
  "template" TEXT NOT NULL,
  "templateAr" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "FollowUpRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FollowUpTask" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "leadId" TEXT,
  "dealId" TEXT,
  "userId" TEXT,
  "title" TEXT NOT NULL,
  "titleAr" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" "FollowUpTaskStatus" NOT NULL DEFAULT 'PENDING',
  "sourceKey" TEXT,
  "completedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FollowUpTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FollowUpRule_organizationId_name_key" ON "FollowUpRule"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "FollowUpRule_organizationId_isActive_idx" ON "FollowUpRule"("organizationId", "isActive");
CREATE INDEX IF NOT EXISTS "FollowUpRule_organizationId_trigger_idx" ON "FollowUpRule"("organizationId", "trigger");
CREATE UNIQUE INDEX IF NOT EXISTS "FollowUpTask_sourceKey_key" ON "FollowUpTask"("sourceKey");
CREATE INDEX IF NOT EXISTS "FollowUpTask_organizationId_status_idx" ON "FollowUpTask"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "FollowUpTask_organizationId_dueAt_idx" ON "FollowUpTask"("organizationId", "dueAt");
CREATE INDEX IF NOT EXISTS "FollowUpTask_ruleId_idx" ON "FollowUpTask"("ruleId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUpRule_organizationId_fkey') THEN
    ALTER TABLE "FollowUpRule" ADD CONSTRAINT "FollowUpRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUpTask_organizationId_fkey') THEN
    ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUpTask_ruleId_fkey') THEN
    ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "FollowUpRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUpTask_leadId_fkey') THEN
    ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUpTask_dealId_fkey') THEN
    ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUpTask_userId_fkey') THEN
    ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
