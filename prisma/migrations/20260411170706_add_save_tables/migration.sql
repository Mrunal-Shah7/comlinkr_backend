-- CreateTable
CREATE TABLE "HousingSave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HousingSave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantSave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantSave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoommateSave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "savedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoommateSave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorySave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorySave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HousingSave_userId_idx" ON "HousingSave"("userId");

-- CreateIndex
CREATE INDEX "HousingSave_listingId_idx" ON "HousingSave"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "HousingSave_userId_listingId_key" ON "HousingSave"("userId", "listingId");

-- CreateIndex
CREATE INDEX "RestaurantSave_userId_idx" ON "RestaurantSave"("userId");

-- CreateIndex
CREATE INDEX "RestaurantSave_restaurantId_idx" ON "RestaurantSave"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantSave_userId_restaurantId_key" ON "RestaurantSave"("userId", "restaurantId");

-- CreateIndex
CREATE INDEX "RoommateSave_userId_idx" ON "RoommateSave"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RoommateSave_userId_savedUserId_key" ON "RoommateSave"("userId", "savedUserId");

-- CreateIndex
CREATE INDEX "StorySave_userId_idx" ON "StorySave"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StorySave_userId_storyId_key" ON "StorySave"("userId", "storyId");

-- AddForeignKey
ALTER TABLE "HousingSave" ADD CONSTRAINT "HousingSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousingSave" ADD CONSTRAINT "HousingSave_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "HousingListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantSave" ADD CONSTRAINT "RestaurantSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantSave" ADD CONSTRAINT "RestaurantSave_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoommateSave" ADD CONSTRAINT "RoommateSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoommateSave" ADD CONSTRAINT "RoommateSave_savedUserId_fkey" FOREIGN KEY ("savedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorySave" ADD CONSTRAINT "StorySave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorySave" ADD CONSTRAINT "StorySave_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
