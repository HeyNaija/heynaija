ALTER TABLE "gists" ADD COLUMN "reply_audience" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "gist_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "hidden_by_host_at" timestamp with time zone;--> statement-breakpoint
-- NOT VALID: gist_id is new, so every existing row is null and there is nothing to check.
ALTER TABLE "posts" ADD CONSTRAINT "posts_gist_id_gists_id_fk" FOREIGN KEY ("gist_id") REFERENCES "public"."gists"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
-- allow-breaking: the index is empty, but building it still scans every posts row once, under the lock ADD COLUMN already holds until this migration commits; a few seconds at this table size
CREATE INDEX "posts_gist_created_idx" ON "posts" USING btree ("gist_id","created_at","id") WHERE gist_id is not null;--> statement-breakpoint
-- NOT VALID: reply_audience and gist_id are new, so every existing row holds the default and there is nothing to check.
ALTER TABLE "gists" ADD CONSTRAINT "gists_reply_audience_check" CHECK (reply_audience in ('everyone', 'following', 'mentioned', 'off')) NOT VALID;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_gist_reply_check" CHECK ("posts"."gist_id" is null or "posts"."quote_post_id" is null) NOT VALID;--> statement-breakpoint
CREATE FUNCTION post_polls_not_in_gist() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM posts WHERE id = NEW.post_id AND gist_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a reply in a Gist cannot have a poll' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER post_polls_not_in_gist BEFORE INSERT ON post_polls FOR EACH ROW EXECUTE FUNCTION post_polls_not_in_gist();
