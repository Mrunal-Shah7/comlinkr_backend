-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('PRIVATE_ROOM', 'SHARED_ROOM', 'STUDIO', 'EN_SUITE');

-- CreateEnum
CREATE TYPE "FurnishedStatus" AS ENUM ('FULLY_FURNISHED', 'PARTIALLY_FURNISHED', 'UNFURNISHED');

-- AlterTable
ALTER TABLE "SharedSpace" ADD COLUMN     "availableFrom" TIMESTAMP(3),
ADD COLUMN     "cleanliness" VARCHAR(100),
ADD COLUMN     "furnishedStatus" "FurnishedStatus",
ADD COLUMN     "genderPreference" VARCHAR(100),
ADD COLUMN     "guestPolicy" VARCHAR(200),
ADD COLUMN     "leaseTerm" VARCHAR(100),
ADD COLUMN     "noiseTolerance" "NoiseTolerance",
ADD COLUMN     "roomType" "RoomType",
ADD COLUMN     "sleepSchedule" "SleepSchedule";
