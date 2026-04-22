-- CreateTable
CREATE TABLE "NewsArticleLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsArticleLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsArticleComment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsArticleComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NewsArticleLike_articleId_idx" ON "NewsArticleLike"("articleId");

-- CreateIndex
CREATE INDEX "NewsArticleLike_userId_idx" ON "NewsArticleLike"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticleLike_userId_articleId_key" ON "NewsArticleLike"("userId", "articleId");

-- CreateIndex
CREATE INDEX "NewsArticleComment_articleId_createdAt_idx" ON "NewsArticleComment"("articleId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NewsArticleComment_userId_idx" ON "NewsArticleComment"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "NewsArticleLike" ADD CONSTRAINT "NewsArticleLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsArticleComment" ADD CONSTRAINT "NewsArticleComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
