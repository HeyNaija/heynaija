CREATE TABLE "story_follows" (
	"story_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_follows_story_id_member_id_pk" PRIMARY KEY("story_id","member_id")
);
--> statement-breakpoint
-- allow-breaking: the check comes straight back below with one more kind, in this same transaction, so nothing the previous release writes is ever unchecked or refused
ALTER TABLE "notification_opt_outs" DROP CONSTRAINT "notification_opt_outs_kind_check";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "story_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "story_updates" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "superseded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "story_follows" ADD CONSTRAINT "story_follows_story_id_posts_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_follows" ADD CONSTRAINT "story_follows_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_follows_member_idx" ON "story_follows" USING btree ("member_id");--> statement-breakpoint
-- allow-breaking: the index is empty (no post has a story_id yet), but building it still scans every posts row once, under the lock ADD COLUMN already holds until this migration commits; a few seconds at this table size
CREATE INDEX "posts_story_created_idx" ON "posts" USING btree ("story_id","created_at","id") WHERE story_id is not null;--> statement-breakpoint
-- NOT VALID: every existing row holds one of the kinds allowed before, all of which are still allowed, so there is nothing to check.
ALTER TABLE "notification_opt_outs" ADD CONSTRAINT "notification_opt_outs_kind_check" CHECK (kind in ('reply', 'like', 'repost', 'quote', 'mention', 'follow', 'story_update')) NOT VALID;--> statement-breakpoint
-- A story's first post knows how many live updates it has, and every post of a
-- story but one is superseded: the newest live update, or the first post while it
-- has none, is the one feeds show (docs/adr/0024). Worked out again whenever an
-- update is added, deleted, taken down, hidden or restored, by whoever does it.
-- Locking the first post first makes two updates at once take turns, so the
-- second sees the first.
CREATE FUNCTION refresh_story(story uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  newest uuid;
  live_count integer;
BEGIN
  PERFORM 1 FROM posts WHERE id = story FOR NO KEY UPDATE;
  SELECT count(*)::int INTO live_count FROM posts u
  WHERE u.story_id = story AND u.deleted_at IS NULL AND u.removed_at IS NULL AND u.hidden_by_host_at IS NULL;
  SELECT u.id INTO newest FROM posts u
  WHERE u.story_id = story AND u.deleted_at IS NULL AND u.removed_at IS NULL AND u.hidden_by_host_at IS NULL
  ORDER BY u.created_at DESC, u.id DESC LIMIT 1;
  UPDATE posts SET story_updates = live_count, superseded = newest IS NOT NULL
  WHERE id = story AND (story_updates, superseded) IS DISTINCT FROM (live_count, newest IS NOT NULL);
  UPDATE posts SET superseded = coalesce(id <> newest, true)
  WHERE story_id = story AND superseded IS DISTINCT FROM coalesce(id <> newest, true);
END $$;
--> statement-breakpoint
CREATE FUNCTION posts_story_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_story(NEW.story_id);
  RETURN NULL;
END $$;
--> statement-breakpoint
-- Its own updates set neither story_id nor the columns listed, so it never fires itself.
CREATE TRIGGER posts_story_changed
AFTER INSERT OR UPDATE OF deleted_at, removed_at, hidden_by_host_at ON posts
FOR EACH ROW WHEN (NEW.story_id IS NOT NULL)
EXECUTE FUNCTION posts_story_changed();
