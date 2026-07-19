-- SPRINT-36: Extend the existing message type without removing or reordering values.
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'AUDIO';

-- SPRINT-36: Store client-rounded voice-note duration in whole seconds.
ALTER TABLE "Message" ADD COLUMN "durationSeconds" INTEGER;
