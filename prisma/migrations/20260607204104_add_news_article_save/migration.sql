-- CreateTable
CREATE TABLE "NewsArticleSave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "imageUrl" VARCHAR(2000),
    "source" VARCHAR(200),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsArticleSave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NewsArticleSave_userId_idx" ON "NewsArticleSave"("userId");

-- CreateIndex
CREATE INDEX "NewsArticleSave_articleId_idx" ON "NewsArticleSave"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticleSave_userId_articleId_key" ON "NewsArticleSave"("userId", "articleId");

-- AddForeignKey
ALTER TABLE "NewsArticleSave" ADD CONSTRAINT "NewsArticleSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
