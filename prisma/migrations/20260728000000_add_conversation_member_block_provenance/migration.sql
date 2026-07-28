-- SPRINT-44: block provenance on ConversationMember
ALTER TABLE "ConversationMember" ADD COLUMN "blockedByUserBlock" BOOLEAN NOT NULL DEFAULT false;

