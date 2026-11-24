-- Package 34: additive property comparison metadata. No existing data is changed.
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "features" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT;
