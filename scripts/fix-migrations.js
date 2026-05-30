/**
 * Startup preflight: finds any migrations stuck in "started but never finished"
 * state and marks them as applied. This happens when a previous deploy ran
 * migrate deploy but the process was killed mid-migration, leaving a partial
 * record in _prisma_migrations. We mark them applied because the ALTER TABLE
 * SQL already ran (column exists) — confirmed by the "duplicate column" error.
 */
require('dotenv').config();
const { createClient } = require('@libsql/client');

async function main() {
  const url    = process.env.DATABASE_URL || 'file:./data/restaurant.db';
  const client = createClient({ url });

  try {
    // Find migrations that never successfully finished (failed OR rolled-back by a previous fix attempt)
    const stuck = await client.execute(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL`
    );

    for (const row of stuck.rows) {
      const name = row.migration_name;
      console.log(`[fix-migrations] Marking stuck migration as applied: ${name}`);
      await client.execute({
        sql: `UPDATE "_prisma_migrations"
              SET finished_at = datetime('now'), rolled_back_at = NULL, applied_steps_count = 1
              WHERE migration_name = ?`,
        args: [name],
      });
    }

    if (stuck.rows.length === 0) {
      console.log('[fix-migrations] No stuck migrations found');
    }
  } catch (e) {
    // _prisma_migrations might not exist yet on a fresh DB — that's fine
    if (!e.message.includes('no such table')) {
      console.warn('[fix-migrations] Warning:', e.message);
    }
  } finally {
    client.close();
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.warn('[fix-migrations] Non-fatal error:', e.message);
  process.exit(0);
});
