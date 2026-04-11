-- AlterTable
ALTER TABLE "Event" ADD COLUMN "conversationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Event_conversationId_key" ON "Event"("conversationId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
