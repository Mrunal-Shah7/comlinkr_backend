/*
  Warnings:

  - Made the column `imageUrl` on table `FeedPostMedia` required. This step will fail if there are existing NULL values in that column.
  - Made the column `imageUrl` on table `HousingImage` required. This step will fail if there are existing NULL values in that column.
  - Made the column `imageUrl` on table `RestaurantImage` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "FeedPostMedia" ALTER COLUMN "imageUrl" SET NOT NULL;

-- AlterTable
ALTER TABLE "HousingImage" ALTER COLUMN "imageUrl" SET NOT NULL;

-- AlterTable
ALTER TABLE "RestaurantImage" ALTER COLUMN "imageUrl" SET NOT NULL;

-- AlterTable
ALTER TABLE "Story" ALTER COLUMN "mediaUrl" DROP DEFAULT;
