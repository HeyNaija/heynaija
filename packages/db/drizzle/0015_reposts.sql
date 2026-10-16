CREATE TABLE "reposts" (
	"member_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reposts_member_id_post_id_pk" PRIMARY KEY("member_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "quote_post_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "repost_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reposts_post_idx" ON "reposts" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "reposts_member_created_idx" ON "reposts" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_repost_once_idx" ON "notifications" USING btree ("recipient_id","actor_id","post_id") WHERE kind = 'repost';--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_quote_once_idx" ON "notifications" USING btree ("recipient_id","actor_id","post_id") WHERE kind = 'quote';--> statement-breakpoint
CREATE INDEX "posts_quote_idx" ON "posts" USING btree ("quote_post_id") WHERE quote_post_id is not null;--> statement-breakpoint
-- posts.repost_count is kept like like_count (migration 0011): by triggers, in
-- the transaction of the repost, unrepost, suspension or reinstatement that
-- changes it, counting reposts by active members only. Statement triggers, so a
-- bulk insert or delete updates each post once.
CREATE FUNCTION reposts_count_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH actor AS (
    SELECT m.id FROM members m WHERE m.id IN (SELECT member_id FROM new_rows) AND m.active FOR SHARE
  ), d AS (
    SELECT r.post_id, count(*)::int AS n FROM new_rows r JOIN actor ON actor.id = r.member_id GROUP BY r.post_id
  )
  UPDATE posts p SET repost_count = p.repost_count + d.n FROM d WHERE p.id = d.post_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION reposts_count_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH actor AS (
    SELECT m.id FROM members m WHERE m.id IN (SELECT member_id FROM old_rows) AND m.active FOR SHARE
  ), d AS (
    SELECT r.post_id, count(*)::int AS n FROM old_rows r JOIN actor ON actor.id = r.member_id GROUP BY r.post_id
  )
  UPDATE posts p SET repost_count = p.repost_count - d.n FROM d WHERE p.id = d.post_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER reposts_count_insert AFTER INSERT ON reposts REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION reposts_count_insert();
--> statement-breakpoint
CREATE TRIGGER reposts_count_delete AFTER DELETE ON reposts REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION reposts_count_delete();
--> statement-breakpoint
-- As in migration 0011, now also moving the member's reposts out of or back into the counts.
CREATE OR REPLACE FUNCTION members_active_counts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  delta int := CASE WHEN NEW.active THEN 1 ELSE -1 END;
BEGIN
  UPDATE posts p SET like_count = p.like_count + delta * d.n
  FROM (SELECT post_id, count(*)::int AS n FROM likes WHERE member_id = NEW.id GROUP BY post_id) d
  WHERE p.id = d.post_id;
  UPDATE posts p SET reply_count = p.reply_count + delta * d.n
  FROM (
    SELECT reply_parent_id AS post_id, count(*)::int AS n FROM posts
    WHERE author_id = NEW.id AND reply_parent_id IS NOT NULL AND deleted_at IS NULL AND removed_at IS NULL
    GROUP BY reply_parent_id
  ) d
  WHERE p.id = d.post_id;
  UPDATE posts p SET repost_count = p.repost_count + delta * d.n
  FROM (SELECT post_id, count(*)::int AS n FROM reposts WHERE member_id = NEW.id GROUP BY post_id) d
  WHERE p.id = d.post_id;
  RETURN NULL;
END $$;
