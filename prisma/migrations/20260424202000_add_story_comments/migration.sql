-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "commentCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StoryComment" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoryComment_storyId_createdAt_idx" ON "StoryComment"("storyId", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "StoryComment_authorId_idx" ON "StoryComment"("authorId");

-- AddForeignKey
ALTER TABLE "StoryComment" ADD CONSTRAINT "StoryComment_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryComment" ADD CONSTRAINT "StoryComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
