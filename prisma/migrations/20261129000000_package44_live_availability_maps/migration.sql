-- Package 44: live availability maps and interactive masterplan pins.
-- Strictly additive: nullable columns and indexes only; existing rows and
-- existing latitude/longitude values are never modified.

ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "cityArea" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "masterplanImageUrl" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "mapX" DECIMAL(7,4);
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "mapY" DECIMAL(7,4);
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "unitLatitude" DECIMAL(10,7);
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "unitLongitude" DECIMAL(10,7);

CREATE INDEX IF NOT EXISTS "Property_organizationId_projectName_idx" ON "Property"("organizationId", "projectName");
CREATE INDEX IF NOT EXISTS "Property_cityArea_idx" ON "Property"("cityArea");
