-- CreateEnum
CREATE TYPE "NeighborhoodMood" AS ENUM ('GREAT', 'EXCITING', 'CHILL', 'MEH', 'NOISY');

-- CreateTable
CREATE TABLE "NeighborhoodMoodVote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "cityKey" TEXT NOT NULL,
    "mood" "NeighborhoodMood" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NeighborhoodMoodVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NeighborhoodMoodVote_userId_cityKey_key" ON "NeighborhoodMoodVote"("userId", "cityKey");

-- CreateIndex
CREATE INDEX "NeighborhoodMoodVote_cityKey_mood_idx" ON "NeighborhoodMoodVote"("cityKey", "mood");

-- AddForeignKey
ALTER TABLE "NeighborhoodMoodVote" ADD CONSTRAINT "NeighborhoodMoodVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
