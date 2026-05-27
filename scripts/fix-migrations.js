/**
 * Preflight: uses the Prisma client (not the CLI) to mark the known-failed
 * facebookPageId migration as rolled-back, then add the column directly.
 * The Prisma runtime does NOT check migration state, so this works even
 * when migrate deploy would be blocked.
 */
require('dotenv').config();
const { PrismaLibSql } = require('@prisma/adapter-libsql');
const { PrismaClient }  = require('./lib/generated/prisma');

const MIGRATION = '20260527100000_add_facebook_page_id';

async function main() {
  const url     = process.env.DATABASE_URL || 'file:./data/restaurant.db';
  const adapter = new PrismaLibSql({ url });
  const db      = new PrismaClient({ adapter });

  try {
    // Mark the failed migration as rolled-back so migrate deploy won't block
    const r = await db.$executeRaw`
      UPDATE "_prisma_migrations"
      SET    "rolled_back_at" = datetime('now')
      WHERE  "migration_name" = ${MIGRATION}
        AND  "finished_at"    IS NULL
        AND  "rolled_back_at" IS NULL
    `;
    if (r > 0) console.log(`[fix-migrations] Marked ${MIGRATION} as rolled-back`);

    // Add the column directly so the re-applied migration won't fail
    // (ignored by SQLite if the column already exists)
    try {
      await db.$executeRaw`ALTER TABLE "Restaurant" ADD COLUMN "facebookPageId" TEXT`;
      console.log('[fix-migrations] Added facebookPageId column');
    } catch (e) {
      if (!e.message.includes('duplicate column')) console.warn('[fix-migrations] ALTER TABLE:', e.message);
    }
  } catch (e) {
    console.warn('[fix-migrations] Could not fix migration state:', e.message);
  } finally {
    await db.$disconnect();
  }
}

main().catch(console.error).then(() => process.exit(0));
