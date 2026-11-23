-- AlterTable
ALTER TABLE "Commission" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "budgetMax" DECIMAL(14,2),
ADD COLUMN     "budgetMin" DECIMAL(14,2),
ADD COLUMN     "preferredAreaMax" DECIMAL(12,2),
ADD COLUMN     "preferredAreaMin" DECIMAL(12,2),
ADD COLUMN     "preferredBedrooms" INTEGER,
ADD COLUMN     "preferredCity" TEXT,
ADD COLUMN     "preferredType" "PropertyType";

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PropertyImage" ALTER COLUMN "updatedAt" DROP DEFAULT;
