-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "maintenanceRequestId" TEXT,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "dueAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Expense_maintenanceRequestId_key" ON "Expense"("maintenanceRequestId");

-- CreateIndex
CREATE INDEX "Expense_maintenanceRequestId_idx" ON "Expense"("maintenanceRequestId");

-- CreateIndex
CREATE INDEX "Payment_dealId_dueAt_idx" ON "Payment"("dealId", "dueAt");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
