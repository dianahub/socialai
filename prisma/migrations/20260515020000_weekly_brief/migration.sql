-- CreateTable
CREATE TABLE "WeeklyBrief" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "restaurantId" INTEGER NOT NULL,
    "weekOf" TEXT NOT NULL,
    "featuredDish" TEXT,
    "event" TEXT,
    "promotion" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyBrief_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyBrief_restaurantId_weekOf_key" ON "WeeklyBrief"("restaurantId", "weekOf");
