-- SPRINT-38: Add denormalised event rating fields matching Restaurant.
ALTER TABLE "Event" ADD COLUMN "averageRating" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "totalReviews" INTEGER NOT NULL DEFAULT 0;

-- SPRINT-38: Create the event review table with the RestaurantReview shape.
CREATE TABLE "EventReview" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReview_pkey" PRIMARY KEY ("id")
);

-- SPRINT-38: Enforce one review per user per event in the database.
CREATE UNIQUE INDEX "EventReview_eventId_userId_key" ON "EventReview"("eventId", "userId");

-- SPRINT-38: Cascade event deletion to its reviews.
ALTER TABLE "EventReview" ADD CONSTRAINT "EventReview_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SPRINT-38: Cascade reviewer deletion to their reviews.
ALTER TABLE "EventReview" ADD CONSTRAINT "EventReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
