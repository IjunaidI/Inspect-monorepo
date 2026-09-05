-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "generatedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
