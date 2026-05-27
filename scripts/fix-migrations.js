/**
 * Preflight script: clears any failed migration records from _prisma_migrations
 * so `prisma migrate deploy` can re-apply them cleanly.
 * Runs before the server starts; exits 0 even on error so startup isn't blocked.
 */
const { createClient } = require('@libsql/client');

const dbUrl = process.env.DATABASE_URL || 'file:./data/restaurant.db';

async function main() {
  const client = createClient({ url: dbUrl });
  try {
    // Delete failed (started but never finished or rolled back) migration records
    // so prisma migrate deploy will re-apply them with the current SQL file
    const result = await client.execute(
      `DELETE FROM "_prisma_migrations"
       WHERE "finished_at" IS NULL
         AND "rolled_back_at" IS NULL`
    );
    if (result.rowsAffected > 0) {
      console.log(`[fix-migrations] Cleared ${result.rowsAffected} failed migration record(s) — will be re-applied`);
    }
  } catch (e) {
    console.warn('[fix-migrations] Could not clear failed migrations:', e.message);
  } finally {
    client.close();
  }
}

main().catch(() => {}).then(() => process.exit(0));
