-- SEC-02: session epoch used to revoke sessions after password recovery / suspension
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- FOD-02: business timezone and currency for restaurants
ALTER TABLE "Restaurant" ADD COLUMN "timezone" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN "currency" TEXT;
