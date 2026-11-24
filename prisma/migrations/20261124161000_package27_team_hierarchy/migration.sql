-- Package 27: tenant-scoped Branch/Team hierarchy.
-- Strictly additive: two new tables, nullable grouping columns on four
-- existing tables, and indexes. No existing row or constraint is changed.

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "leaderId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- AlterTable (nullable columns; existing rows keep NULL and unchanged visibility)
ALTER TABLE "User" ADD COLUMN "branchId" TEXT;
ALTER TABLE "User" ADD COLUMN "teamId" TEXT;
ALTER TABLE "Property" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Property" ADD COLUMN "teamId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "teamId" TEXT;
ALTER TABLE "Deal" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Deal" ADD COLUMN "teamId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Branch_organizationId_name_key" ON "Branch"("organizationId", "name");
CREATE INDEX "Branch_organizationId_idx" ON "Branch"("organizationId");

CREATE UNIQUE INDEX "Team_organizationId_name_key" ON "Team"("organizationId", "name");
CREATE INDEX "Team_organizationId_idx" ON "Team"("organizationId");
CREATE INDEX "Team_branchId_idx" ON "Team"("branchId");

CREATE INDEX "User_branchId_idx" ON "User"("branchId");
CREATE INDEX "User_teamId_idx" ON "User"("teamId");
CREATE INDEX "Property_branchId_idx" ON "Property"("branchId");
CREATE INDEX "Property_teamId_idx" ON "Property"("teamId");
CREATE INDEX "Lead_branchId_idx" ON "Lead"("branchId");
CREATE INDEX "Lead_teamId_idx" ON "Lead"("teamId");
CREATE INDEX "Deal_branchId_idx" ON "Deal"("branchId");
CREATE INDEX "Deal_teamId_idx" ON "Deal"("teamId");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Team" ADD CONSTRAINT "Team_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Team" ADD CONSTRAINT "Team_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Property" ADD CONSTRAINT "Property_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Property" ADD CONSTRAINT "Property_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
