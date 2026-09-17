-- DropForeignKey
ALTER TABLE "CategoryKeyword" DROP CONSTRAINT "CategoryKeyword_categoryId_fkey";

-- AddForeignKey
ALTER TABLE "CategoryKeyword" ADD CONSTRAINT "CategoryKeyword_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;