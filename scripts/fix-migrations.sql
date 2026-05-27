-- Mark the failed facebookPageId migration as rolled-back so migrate deploy can retry it
UPDATE "_prisma_migrations"
SET    "rolled_back_at" = datetime('now')
WHERE  "migration_name" = '20260527100000_add_facebook_page_id'
  AND  "finished_at"    IS NULL
  AND  "rolled_back_at" IS NULL;
