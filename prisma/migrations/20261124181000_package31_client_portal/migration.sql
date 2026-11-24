-- Package 31: revocable read-only client portal links for leads and deals.
-- Strictly additive: existing rows keep portalEnabled=false and NULL tokens.

ALTER TABLE "Lead" ADD COLUMN "portalToken" TEXT;
ALTER TABLE "Deal" ADD COLUMN "portalToken" TEXT;
ALTER TABLE "Lead" ADD COLUMN "portalEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Deal" ADD COLUMN "portalEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Lead_portalToken_key" ON "Lead"("portalToken");
CREATE UNIQUE INDEX "Deal_portalToken_key" ON "Deal"("portalToken");
CREATE INDEX "Lead_portalEnabled_idx" ON "Lead"("portalEnabled");
CREATE INDEX "Deal_portalEnabled_idx" ON "Deal"("portalEnabled");
