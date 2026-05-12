-- AlterTable: add topic and lastUsedAt to ScriptTemplate
ALTER TABLE "ScriptTemplate" ADD COLUMN "topic" TEXT;
ALTER TABLE "ScriptTemplate" ADD COLUMN "lastUsedAt" DATETIME;
