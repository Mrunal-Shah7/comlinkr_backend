-- CreateTable
CREATE TABLE "CommunityPoll" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "question" VARCHAR(500) NOT NULL,
    "optionAId" VARCHAR(8) NOT NULL DEFAULT 'a',
    "optionALabel" VARCHAR(300) NOT NULL,
    "optionBId" VARCHAR(8) NOT NULL DEFAULT 'b',
    "optionBLabel" VARCHAR(300) NOT NULL,
    "votesA" INTEGER NOT NULL DEFAULT 0,
    "votesB" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityPoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityPollVote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" VARCHAR(8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityPollVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunityPoll_city_isActive_idx" ON "CommunityPoll"("city", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityPollVote_userId_pollId_key" ON "CommunityPollVote"("userId", "pollId");

-- AddForeignKey
ALTER TABLE "CommunityPollVote" ADD CONSTRAINT "CommunityPollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPollVote" ADD CONSTRAINT "CommunityPollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "CommunityPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
