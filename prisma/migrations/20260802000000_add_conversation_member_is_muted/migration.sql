-- SPRINT-45: per-member mute flag on ConversationMember
ALTER TABLE "ConversationMember" ADD COLUMN "isMuted" BOOLEAN NOT NULL DEFAULT false;
