-- Package 28: revocable tenant-scoped owner portal links.
-- Strictly additive: two columns and one unique index on Owner. Existing
-- owners keep portalEnabled=false and a NULL token, so no link works until a
-- manager explicitly generates one.

ALTER TABLE "Owner" ADD COLUMN "portalToken" TEXT;
ALTER TABLE "Owner" ADD COLUMN "portalEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Owner_portalToken_key" ON "Owner"("portalToken");
CREATE INDEX "Owner_portalEnabled_idx" ON "Owner"("portalEnabled");
