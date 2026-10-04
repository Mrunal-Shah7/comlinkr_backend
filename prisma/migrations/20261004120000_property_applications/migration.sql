-- Property (tenancy) applications and the user's My Documents store
-- CreateEnum
CREATE TYPE "PropertyApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SIGNED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "SignatureType" AS ENUM ('TYPED', 'DRAWN');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'HELD', 'RELEASED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "UserDocumentType" AS ENUM ('TENANCY_AGREEMENT');

-- CreateTable
CREATE TABLE "PropertyApplication" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "landlordId" TEXT NOT NULL,
    "status" "PropertyApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "personalInfo" JSONB,
    "rentalHistory" JSONB,
    "financialDetails" JSONB,
    "agreementTerms" JSONB,
    "moveInDate" TIMESTAMP(3),
    "rentAmount" DECIMAL(65,30),
    "depositAmount" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "signature" TEXT,
    "signatureType" "SignatureType",
    "tenantSignedAt" TIMESTAMP(3),
    "landlordNote" VARCHAR(1000),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "depositStatus" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "depositReference" TEXT,
    "depositScheme" TEXT,
    "depositRequestedAt" TIMESTAMP(3),
    "depositHeldAt" TIMESTAMP(3),
    "depositReleasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "UserDocumentType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "fileKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "propertyApplicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyApplication_depositReference_key" ON "PropertyApplication"("depositReference");

-- CreateIndex
CREATE INDEX "PropertyApplication_applicantId_idx" ON "PropertyApplication"("applicantId");

-- CreateIndex
CREATE INDEX "PropertyApplication_landlordId_status_idx" ON "PropertyApplication"("landlordId", "status");

-- CreateIndex
CREATE INDEX "PropertyApplication_listingId_applicantId_idx" ON "PropertyApplication"("listingId", "applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "UserDocument_propertyApplicationId_key" ON "UserDocument"("propertyApplicationId");

-- CreateIndex
CREATE INDEX "UserDocument_userId_createdAt_idx" ON "UserDocument"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PropertyApplication" ADD CONSTRAINT "PropertyApplication_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "HousingListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyApplication" ADD CONSTRAINT "PropertyApplication_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyApplication" ADD CONSTRAINT "PropertyApplication_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_propertyApplicationId_fkey" FOREIGN KEY ("propertyApplicationId") REFERENCES "PropertyApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

