-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'REPLIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BroadcastAudienceType" AS ENUM ('ALL', 'CITY', 'SELECTIVE');

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastNotification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "audienceType" "BroadcastAudienceType" NOT NULL,
    "audienceCity" TEXT,
    "audienceUserIds" TEXT[],
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "adminReply" VARCHAR(2000),
    "repliedAt" TIMESTAMP(3),
    "repliedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPoll" (
    "id" TEXT NOT NULL,
    "question" VARCHAR(300) NOT NULL,
    "createdById" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminPoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPollOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "votesCount" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AdminPollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPollVote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPollVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

-- CreateIndex
CREATE INDEX "BroadcastNotification_sentById_idx" ON "BroadcastNotification"("sentById");

-- CreateIndex
CREATE INDEX "BroadcastNotification_createdAt_idx" ON "BroadcastNotification"("createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_idx" ON "SupportTicket"("userId");

-- CreateIndex
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");

-- CreateIndex
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- CreateIndex
CREATE INDEX "AdminPoll_createdById_idx" ON "AdminPoll"("createdById");

-- CreateIndex
CREATE INDEX "AdminPollOption_pollId_idx" ON "AdminPollOption"("pollId");

-- CreateIndex
CREATE INDEX "AdminPollVote_optionId_idx" ON "AdminPollVote"("optionId");

-- CreateIndex
CREATE INDEX "AdminPollVote_userId_idx" ON "AdminPollVote"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPollVote_pollId_userId_key" ON "AdminPollVote"("pollId", "userId");

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastNotification" ADD CONSTRAINT "BroadcastNotification_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_repliedById_fkey" FOREIGN KEY ("repliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPoll" ADD CONSTRAINT "AdminPoll_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPollOption" ADD CONSTRAINT "AdminPollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "AdminPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPollVote" ADD CONSTRAINT "AdminPollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "AdminPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPollVote" ADD CONSTRAINT "AdminPollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "AdminPollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPollVote" ADD CONSTRAINT "AdminPollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
