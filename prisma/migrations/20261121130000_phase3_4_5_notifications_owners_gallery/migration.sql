-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "organizationId" TEXT,
ADD COLUMN "readAt" TIMESTAMP(3),
ADD COLUMN "entityType" TEXT,
ADD COLUMN "entityId" TEXT,
ADD COLUMN "actionUrl" TEXT,
ADD COLUMN "metadata" JSONB;

-- AlterTable
ALTER TABLE "Owner" ADD COLUMN "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PropertyImage" ADD COLUMN "storageKey" TEXT,
ADD COLUMN "originalName" TEXT,
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "size" INTEGER,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "uploadedById" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Owner_organizationId_idx" ON "Owner"("organizationId");

-- CreateIndex
CREATE INDEX "Owner_isActive_deletedAt_idx" ON "Owner"("isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "PropertyImage_propertyId_deletedAt_idx" ON "PropertyImage"("propertyId", "deletedAt");

-- CreateIndex
CREATE INDEX "PropertyImage_propertyId_sortOrder_idx" ON "PropertyImage"("propertyId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Owner" ADD CONSTRAINT "Owner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyImage" ADD CONSTRAINT "PropertyImage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
