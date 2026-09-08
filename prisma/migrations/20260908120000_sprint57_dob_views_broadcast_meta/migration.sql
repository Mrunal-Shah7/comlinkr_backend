-- SPRINT-57: date of birth (age is derived, never stored)
ALTER TABLE "User" ADD COLUMN "dateOfBirth" TIMESTAMP(3);

-- SPRINT-57: unique-viewer counts for feed posts
ALTER TABLE "FeedPost" ADD COLUMN "viewsCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "FeedPostView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedPostId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedPostView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeedPostView_userId_feedPostId_key" ON "FeedPostView"("userId", "feedPostId");
CREATE INDEX "FeedPostView_feedPostId_idx" ON "FeedPostView"("feedPostId");

ALTER TABLE "FeedPostView" ADD CONSTRAINT "FeedPostView_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedPostView" ADD CONSTRAINT "FeedPostView_feedPostId_fkey"
    FOREIGN KEY ("feedPostId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SPRINT-57: broadcast priority / scheduling / delivery state
CREATE TYPE "BroadcastPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENT', 'FAILED');

-- Every pre-existing row is an already-sent broadcast, so SENT is the correct default.
ALTER TABLE "BroadcastNotification"
    ADD COLUMN "priority" "BroadcastPriority" NOT NULL DEFAULT 'NORMAL',
    ADD COLUMN "status" "BroadcastStatus" NOT NULL DEFAULT 'SENT',
    ADD COLUMN "scheduledFor" TIMESTAMP(3),
    ADD COLUMN "sentAt" TIMESTAMP(3),
    ADD COLUMN "failureReason" TEXT;

-- Backfill sentAt for history so the admin list can show a real delivery time.
UPDATE "BroadcastNotification" SET "sentAt" = "createdAt" WHERE "sentAt" IS NULL;

CREATE INDEX "BroadcastNotification_status_scheduledFor_idx" ON "BroadcastNotification"("status", "scheduledFor");

-- SPRINT-57: open-rate aggregation per broadcast
CREATE INDEX "Notification_referenceType_referenceId_idx" ON "Notification"("referenceType", "referenceId");
