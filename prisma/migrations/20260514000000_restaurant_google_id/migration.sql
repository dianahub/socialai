-- Add googleId field for Google OAuth sign-in
ALTER TABLE "Restaurant" ADD COLUMN "google_id" TEXT;
CREATE UNIQUE INDEX "Restaurant_google_id_key" ON "Restaurant"("google_id");
