-- SPRINT-51: recreate ListingReportTargetType with all nine values (same-transaction safe)
CREATE TYPE "ListingReportTargetType_new" AS ENUM (
  'HOUSING',
  'RESTAURANT',
  'USER',
  'COMMUNITY_POST',
  'COMMUNITY_MEMBER',
  'COMMUNITY_QUESTION',
  'COMMUNITY_ANSWER',
  'EVENT',
  'CHAT_MESSAGE'
);

ALTER TABLE "ListingReport"
  ALTER COLUMN "targetType" TYPE "ListingReportTargetType_new"
  USING ("targetType"::text::"ListingReportTargetType_new");

DROP TYPE "ListingReportTargetType";
ALTER TYPE "ListingReportTargetType_new" RENAME TO "ListingReportTargetType";

-- SPRINT-51: migrate ContentReport rows into ListingReport before clearing ContentReport
INSERT INTO "ListingReport" ("id", "reporterId", "targetType", "targetId", "reason", "status", "createdAt", "updatedAt")
SELECT
  cr."id",
  cr."reporterId",
  CASE UPPER(cr."targetType")
    WHEN 'EVENT' THEN 'EVENT'::"ListingReportTargetType"
    WHEN 'USER' THEN 'USER'::"ListingReportTargetType"
    WHEN 'COMMUNITY_POST' THEN 'COMMUNITY_POST'::"ListingReportTargetType"
    WHEN 'COMMUNITY_MEMBER' THEN 'COMMUNITY_MEMBER'::"ListingReportTargetType"
    WHEN 'COMMUNITY_QUESTION' THEN 'COMMUNITY_QUESTION'::"ListingReportTargetType"
    WHEN 'QUESTION' THEN 'COMMUNITY_QUESTION'::"ListingReportTargetType"
    WHEN 'COMMUNITY_ANSWER' THEN 'COMMUNITY_ANSWER'::"ListingReportTargetType"
    WHEN 'ANSWER' THEN 'COMMUNITY_ANSWER'::"ListingReportTargetType"
    WHEN 'CHAT_MESSAGE' THEN 'CHAT_MESSAGE'::"ListingReportTargetType"
    WHEN 'HOUSING' THEN 'HOUSING'::"ListingReportTargetType"
    WHEN 'RESTAURANT' THEN 'RESTAURANT'::"ListingReportTargetType"
    ELSE NULL
  END,
  cr."targetId",
  cr."reason",
  'PENDING'::"ListingReportStatus",
  cr."createdAt",
  cr."createdAt"
FROM "ContentReport" cr
WHERE NOT EXISTS (
  SELECT 1 FROM "ListingReport" lr WHERE lr."id" = cr."id"
)
AND UPPER(cr."targetType") IN (
  'EVENT', 'USER', 'COMMUNITY_POST', 'COMMUNITY_MEMBER',
  'COMMUNITY_QUESTION', 'QUESTION', 'COMMUNITY_ANSWER', 'ANSWER',
  'CHAT_MESSAGE', 'HOUSING', 'RESTAURANT'
);

DELETE FROM "ContentReport" cr
WHERE EXISTS (
  SELECT 1 FROM "ListingReport" lr WHERE lr."id" = cr."id"
);

-- SPRINT-51: warning history
CREATE TABLE "WarningRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WarningRecord_pkey" PRIMARY KEY ("id")
);

-- SPRINT-51: ban/suspension history
CREATE TABLE "BanRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reportId" TEXT,
    "durationDays" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "liftedAt" TIMESTAMP(3),
    "liftedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BanRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WarningRecord_userId_idx" ON "WarningRecord"("userId");
CREATE INDEX "WarningRecord_adminId_idx" ON "WarningRecord"("adminId");
CREATE INDEX "WarningRecord_reportId_idx" ON "WarningRecord"("reportId");

CREATE INDEX "BanRecord_userId_idx" ON "BanRecord"("userId");
CREATE INDEX "BanRecord_adminId_idx" ON "BanRecord"("adminId");
CREATE INDEX "BanRecord_reportId_idx" ON "BanRecord"("reportId");
CREATE INDEX "BanRecord_expiresAt_liftedAt_idx" ON "BanRecord"("expiresAt", "liftedAt");

ALTER TABLE "WarningRecord" ADD CONSTRAINT "WarningRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarningRecord" ADD CONSTRAINT "WarningRecord_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarningRecord" ADD CONSTRAINT "WarningRecord_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ListingReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BanRecord" ADD CONSTRAINT "BanRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BanRecord" ADD CONSTRAINT "BanRecord_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BanRecord" ADD CONSTRAINT "BanRecord_liftedByAdminId_fkey" FOREIGN KEY ("liftedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BanRecord" ADD CONSTRAINT "BanRecord_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ListingReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
