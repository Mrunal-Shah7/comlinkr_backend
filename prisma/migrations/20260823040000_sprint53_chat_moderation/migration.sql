-- SPRINT-53: widen block provenance from boolean to three-state enum
CREATE TYPE "BlockProvenance" AS ENUM ('NONE', 'USER_BLOCK', 'ADMIN_BAN');

ALTER TABLE "ConversationMember" ADD COLUMN "blockProvenance" "BlockProvenance";

-- SPRINT-53: preserve meaning — true → USER_BLOCK, false → NONE
UPDATE "ConversationMember"
SET "blockProvenance" = CASE
  WHEN "blockedByUserBlock" = true THEN 'USER_BLOCK'::"BlockProvenance"
  ELSE 'NONE'::"BlockProvenance"
END;

ALTER TABLE "ConversationMember" ALTER COLUMN "blockProvenance" SET NOT NULL;
ALTER TABLE "ConversationMember" ALTER COLUMN "blockProvenance" SET DEFAULT 'NONE'::"BlockProvenance";

ALTER TABLE "ConversationMember" DROP COLUMN "blockedByUserBlock";

-- SPRINT-53: conversation-scoped chat bans on BanRecord
ALTER TABLE "BanRecord" ADD COLUMN "conversationId" TEXT;

CREATE INDEX "BanRecord_conversationId_idx" ON "BanRecord"("conversationId");

ALTER TABLE "BanRecord" ADD CONSTRAINT "BanRecord_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
