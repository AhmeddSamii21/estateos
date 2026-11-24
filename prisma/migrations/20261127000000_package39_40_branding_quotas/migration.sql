-- Packages 39-40: tenant-owned white-label branding and SaaS plan quota rows.
-- Strictly additive: no existing table or column is altered or removed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BrandingTheme') THEN
    CREATE TYPE "BrandingTheme" AS ENUM ('LIGHT', 'DARK', 'AUTO');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlanTier') THEN
    CREATE TYPE "PlanTier" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'ENTERPRISE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OrganizationBranding" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "brandName" TEXT,
  "brandNameAr" TEXT,
  "logoUrl" TEXT,
  "faviconUrl" TEXT,
  "primaryColor" TEXT NOT NULL DEFAULT '#2563EB',
  "secondaryColor" TEXT NOT NULL DEFAULT '#0F172A',
  "accentColor" TEXT NOT NULL DEFAULT '#14B8A6',
  "supportEmail" TEXT,
  "supportPhone" TEXT,
  "footerText" TEXT,
  "footerTextAr" TEXT,
  "theme" "BrandingTheme" NOT NULL DEFAULT 'LIGHT',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganizationBranding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlanQuota" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
  "userLimit" INTEGER,
  "propertyLimit" INTEGER,
  "dealLimit" INTEGER,
  "storageMbLimit" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlanQuota_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationBranding_organizationId_key" ON "OrganizationBranding"("organizationId");
CREATE INDEX IF NOT EXISTS "OrganizationBranding_organizationId_idx" ON "OrganizationBranding"("organizationId");

CREATE UNIQUE INDEX IF NOT EXISTS "PlanQuota_organizationId_key" ON "PlanQuota"("organizationId");
CREATE INDEX IF NOT EXISTS "PlanQuota_organizationId_idx" ON "PlanQuota"("organizationId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationBranding_organizationId_fkey') THEN
    ALTER TABLE "OrganizationBranding" ADD CONSTRAINT "OrganizationBranding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlanQuota_organizationId_fkey') THEN
    ALTER TABLE "PlanQuota" ADD CONSTRAINT "PlanQuota_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
