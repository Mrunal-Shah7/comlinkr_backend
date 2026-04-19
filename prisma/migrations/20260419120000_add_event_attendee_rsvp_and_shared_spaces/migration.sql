-- AlterTable
ALTER TABLE "EventAttendee" ADD COLUMN     "attendeeName" TEXT,
ADD COLUMN     "attendeeEmail" TEXT,
ADD COLUMN     "attendeePhone" TEXT,
ADD COLUMN     "ticketCount" INTEGER NOT NULL DEFAULT 1;

-- CreateEnum
CREATE TYPE "SharedSpaceApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "SharedSpace" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "price" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "deposit" DECIMAL(65,30),
    "rooms" INTEGER NOT NULL,
    "bathrooms" INTEGER NOT NULL,
    "totalOccupants" INTEGER NOT NULL,
    "currentOccupants" INTEGER NOT NULL DEFAULT 0,
    "availableSpots" INTEGER NOT NULL,
    "petPolicy" TEXT,
    "smoking" BOOLEAN NOT NULL DEFAULT false,
    "amenities" TEXT[],
    "houseRules" TEXT[],
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedSpaceImage" (
    "id" TEXT NOT NULL,
    "sharedSpaceId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SharedSpaceImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedSpaceApplication" (
    "id" TEXT NOT NULL,
    "sharedSpaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT,
    "status" "SharedSpaceApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedSpaceApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedSpaceSave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sharedSpaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedSpaceSave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedSpace_city_idx" ON "SharedSpace"("city");

-- CreateIndex
CREATE INDEX "SharedSpace_ownerId_idx" ON "SharedSpace"("ownerId");

-- AddForeignKey
ALTER TABLE "SharedSpace" ADD CONSTRAINT "SharedSpace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSpaceImage" ADD CONSTRAINT "SharedSpaceImage_sharedSpaceId_fkey" FOREIGN KEY ("sharedSpaceId") REFERENCES "SharedSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSpaceApplication" ADD CONSTRAINT "SharedSpaceApplication_sharedSpaceId_fkey" FOREIGN KEY ("sharedSpaceId") REFERENCES "SharedSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSpaceApplication" ADD CONSTRAINT "SharedSpaceApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSpaceSave" ADD CONSTRAINT "SharedSpaceSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSpaceSave" ADD CONSTRAINT "SharedSpaceSave_sharedSpaceId_fkey" FOREIGN KEY ("sharedSpaceId") REFERENCES "SharedSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "SharedSpaceApplication_sharedSpaceId_userId_key" ON "SharedSpaceApplication"("sharedSpaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedSpaceSave_userId_sharedSpaceId_key" ON "SharedSpaceSave"("userId", "sharedSpaceId");
