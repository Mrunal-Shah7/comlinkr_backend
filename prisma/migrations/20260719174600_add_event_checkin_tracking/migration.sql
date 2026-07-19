-- SPRINT-38: Preserve registration lifecycle state so cancelled tickets have a distinct scanner result.
CREATE TYPE "EventRegistrationStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- SPRINT-38: Add cancellation and one-time check-in tracking to the existing registration row and UUID.
ALTER TABLE "EventAttendee"
ADD COLUMN "status" "EventRegistrationStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "checkedInAt" TIMESTAMP(3),
ADD COLUMN "checkedInById" TEXT;

-- SPRINT-38: Support event-scoped status counts and filtered check-in lists.
CREATE INDEX "EventAttendee_eventId_status_checkedInAt_idx" ON "EventAttendee"("eventId", "status", "checkedInAt");

-- SPRINT-38: Preserve check-in timestamps if the checking organiser account is removed.
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
