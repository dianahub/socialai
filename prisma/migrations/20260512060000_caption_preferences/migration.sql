-- Caption preferences per restaurant
ALTER TABLE "Restaurant" ADD COLUMN "voiceTone" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN "defaultHashtags" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN "includeLocation" BOOLEAN NOT NULL DEFAULT true;
