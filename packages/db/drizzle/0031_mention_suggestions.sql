-- An earlier copy of this branch made these indexes as 0029, so a database migrated from it already has them.
-- allow-breaking: members is small; the partial index builds in well under a second
CREATE INDEX IF NOT EXISTS "members_handle_prefix_idx" ON "members" USING btree (handle collate "C") WHERE active;--> statement-breakpoint
-- allow-breaking: members is small; the partial index builds in well under a second
CREATE INDEX IF NOT EXISTS "members_name_prefix_idx" ON "members" USING btree (lower(display_name) collate "C") WHERE active and display_name is not null;