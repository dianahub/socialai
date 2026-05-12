-- Add auto-publish tracking fields to ScheduledPost
ALTER TABLE "ScheduledPost" ADD COLUMN "publishAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ScheduledPost" ADD COLUMN "lastError" TEXT;
