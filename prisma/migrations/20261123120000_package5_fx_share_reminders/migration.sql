-- Package 5: Managed FX rates, public property share links, reminder-ready metadata

-- Currency: move uniqueness from global code to org-scoped code
ALTER TABLE "Currency" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
DROP INDEX IF EXISTS "Currency_code_key";
CREATE UNIQUE INDEX "Currency_organizationId_code_key" ON "Currency"("organizationId", "code");

-- ExchangeRate: scope to organization
ALTER TABLE "ExchangeRate" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "ExchangeRate_organizationId_idx" ON "ExchangeRate"("organizationId");
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Property: revocable public share link
ALTER TABLE "Property" ADD COLUMN "publicShareToken" TEXT;
ALTER TABLE "Property" ADD COLUMN "publicShareEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Property" ADD COLUMN "publicShareExpiresAt" TIMESTAMP(3);
ALTER TABLE "Property" ADD COLUMN "publicShareCreatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Property_publicShareToken_key" ON "Property"("publicShareToken");
