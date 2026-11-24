-- Packages 29-30: self-service profile fields and monthly sales targets.
-- Strictly additive. Existing users keep en as their preferred language,
-- no avatar/phone/job title/target, and all existing account states unchanged.

ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "jobTitle" TEXT;
ALTER TABLE "User" ADD COLUMN "preferredLang" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "User" ADD COLUMN "monthlyTargetAmount" DECIMAL(14,2);

CREATE INDEX "User_organizationId_teamId_isActive_idx" ON "User"("organizationId", "teamId", "isActive");
