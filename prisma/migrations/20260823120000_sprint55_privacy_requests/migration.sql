-- SPRINT-55: privacy requests + deletion source tagging
CREATE TYPE "DeletionSource" AS ENUM ('NONE', 'SELF', 'ADMIN');
CREATE TYPE "PrivacyRequestType" AS ENUM ('DATA_EXPORT', 'ERASURE');
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');

ALTER TABLE "User" ADD COLUMN "deletionSource" "DeletionSource" NOT NULL DEFAULT 'NONE';

CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "snapshotUsername" VARCHAR(120) NOT NULL,
    "snapshotEmail" VARCHAR(255) NOT NULL,
    "type" "PrivacyRequestType" NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL,
    "requestedByAdminId" TEXT,
    "reason" VARCHAR(1000),
    "exportFileKey" TEXT,
    "exportPayload" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrivacyRequest_userId_idx" ON "PrivacyRequest"("userId");
CREATE INDEX "PrivacyRequest_type_idx" ON "PrivacyRequest"("type");
CREATE INDEX "PrivacyRequest_status_idx" ON "PrivacyRequest"("status");
CREATE INDEX "PrivacyRequest_createdAt_idx" ON "PrivacyRequest"("createdAt");

ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_requestedByAdminId_fkey" FOREIGN KEY ("requestedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
