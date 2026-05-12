-- AlterTable: add scheduledPostId and errorMessage to GenerationJob
ALTER TABLE "GenerationJob" ADD COLUMN "scheduledPostId" INTEGER;
ALTER TABLE "GenerationJob" ADD COLUMN "errorMessage" TEXT;
