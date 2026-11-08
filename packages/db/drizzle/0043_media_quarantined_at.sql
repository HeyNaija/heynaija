-- When an image's files went to the quarantine (taken down, or kept as evidence), so
-- they can be deleted TAKEN_DOWN_MEDIA_RETENTION_DAYS later (/privacy#keep). Nullable:
-- the previous release never writes it, and the first sweep dates what it quarantined.
ALTER TABLE "media" ADD COLUMN "quarantined_at" timestamp with time zone;
