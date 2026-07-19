-- SPRINT-34: Store the Apple refresh token needed for account-deletion revocation.
ALTER TABLE "AuthProvider" ADD COLUMN "refreshToken" TEXT;
