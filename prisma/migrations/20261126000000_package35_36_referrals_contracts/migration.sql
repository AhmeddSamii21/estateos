-- Packages 35-36: tenant-owned referral partners, deal splits and bilingual contract templates.
-- Strictly additive: no existing table or column is altered or removed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReferralSplitStatus') THEN
    CREATE TYPE "ReferralSplitStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContractTemplateLanguage') THEN
    CREATE TYPE "ContractTemplateLanguage" AS ENUM ('EN', 'AR', 'BILINGUAL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ReferralPartner" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "companyName" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 10,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "ReferralPartner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ReferralSplit" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "rate" DECIMAL(5,2) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" "ReferralSplitStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "approvedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReferralSplit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ContractTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "language" "ContractTemplateLanguage" NOT NULL DEFAULT 'BILINGUAL',
  "body" TEXT NOT NULL,
  "bodyAr" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralPartner_organizationId_name_key" ON "ReferralPartner"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "ReferralPartner_organizationId_idx" ON "ReferralPartner"("organizationId");
CREATE INDEX IF NOT EXISTS "ReferralPartner_organizationId_isActive_idx" ON "ReferralPartner"("organizationId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralSplit_dealId_partnerId_key" ON "ReferralSplit"("dealId", "partnerId");
CREATE INDEX IF NOT EXISTS "ReferralSplit_organizationId_idx" ON "ReferralSplit"("organizationId");
CREATE INDEX IF NOT EXISTS "ReferralSplit_dealId_idx" ON "ReferralSplit"("dealId");
CREATE INDEX IF NOT EXISTS "ReferralSplit_partnerId_idx" ON "ReferralSplit"("partnerId");
CREATE INDEX IF NOT EXISTS "ReferralSplit_status_idx" ON "ReferralSplit"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "ContractTemplate_organizationId_name_key" ON "ContractTemplate"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "ContractTemplate_organizationId_idx" ON "ContractTemplate"("organizationId");
CREATE INDEX IF NOT EXISTS "ContractTemplate_organizationId_isActive_idx" ON "ContractTemplate"("organizationId", "isActive");

ALTER TABLE "ReferralPartner" ADD CONSTRAINT "ReferralPartner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralSplit" ADD CONSTRAINT "ReferralSplit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralSplit" ADD CONSTRAINT "ReferralSplit_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralSplit" ADD CONSTRAINT "ReferralSplit_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ReferralPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractTemplate" ADD CONSTRAINT "ContractTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
