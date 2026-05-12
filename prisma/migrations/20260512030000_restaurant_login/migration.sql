ALTER TABLE "Restaurant" ADD COLUMN "loginEmail" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN "loginPasswordHash" TEXT;
CREATE UNIQUE INDEX "Restaurant_loginEmail_key" ON "Restaurant"("loginEmail");
