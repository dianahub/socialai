-- Add token expiry tracking for Instagram OAuth
ALTER TABLE "Restaurant" ADD COLUMN "tokenExpiresAt" DATETIME;
