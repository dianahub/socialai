-- Clear all seed/fake scheduled posts and their generation jobs
DELETE FROM "GenerationJob";
DELETE FROM "ScheduledPost";
