-- Delete the failed facebookPageId migration record so migrate deploy re-applies it fresh
DELETE FROM "_prisma_migrations"
WHERE  "migration_name" = '20260527100000_add_facebook_page_id'
  AND  "finished_at"    IS NULL;
