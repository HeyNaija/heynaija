ALTER TABLE "posts" ADD COLUMN "like_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "reply_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- posts.like_count and posts.reply_count are kept by the triggers below rather
-- than by the API, so every writer keeps them right: this release, an older one
-- after a rollback (which knows nothing of the columns), and the scripts in
-- loadtest/. Each runs in the transaction of the write that changes a count.
--
-- What counts matches what readers have always been shown: likes by active
-- members, and direct replies that are live (not deleted, not removed) and by
-- active members. Suspending or reinstating a member moves their likes and
-- replies out of or back into the counts (members_active_counts). The active
-- check takes a share lock on the member row, so a like that races a suspension
-- waits for it and is counted or not according to its outcome; no periodic
-- reconcile is needed.
--
-- Likes and post inserts/deletes use statement triggers, so a bulk insert (the
-- load-test seed) updates each post once rather than once per row.
CREATE FUNCTION likes_count_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH actor AS (
    SELECT m.id FROM members m WHERE m.id IN (SELECT member_id FROM new_rows) AND m.active FOR SHARE
  ), d AS (
    SELECT l.post_id, count(*)::int AS n FROM new_rows l JOIN actor ON actor.id = l.member_id GROUP BY l.post_id
  )
  UPDATE posts p SET like_count = p.like_count + d.n FROM d WHERE p.id = d.post_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION likes_count_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH actor AS (
    SELECT m.id FROM members m WHERE m.id IN (SELECT member_id FROM old_rows) AND m.active FOR SHARE
  ), d AS (
    SELECT l.post_id, count(*)::int AS n FROM old_rows l JOIN actor ON actor.id = l.member_id GROUP BY l.post_id
  )
  UPDATE posts p SET like_count = p.like_count - d.n FROM d WHERE p.id = d.post_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER likes_count_insert AFTER INSERT ON likes REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION likes_count_insert();
--> statement-breakpoint
CREATE TRIGGER likes_count_delete AFTER DELETE ON likes REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION likes_count_delete();
--> statement-breakpoint
CREATE FUNCTION replies_count_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH author AS (
    SELECT m.id FROM members m
    WHERE m.id IN (SELECT author_id FROM new_rows WHERE reply_parent_id IS NOT NULL) AND m.active FOR SHARE
  ), d AS (
    SELECT r.reply_parent_id AS post_id, count(*)::int AS n FROM new_rows r JOIN author ON author.id = r.author_id
    WHERE r.reply_parent_id IS NOT NULL AND r.deleted_at IS NULL AND r.removed_at IS NULL
    GROUP BY r.reply_parent_id
  )
  UPDATE posts p SET reply_count = p.reply_count + d.n FROM d WHERE p.id = d.post_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION replies_count_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH author AS (
    SELECT m.id FROM members m
    WHERE m.id IN (SELECT author_id FROM old_rows WHERE reply_parent_id IS NOT NULL) AND m.active FOR SHARE
  ), d AS (
    SELECT r.reply_parent_id AS post_id, count(*)::int AS n FROM old_rows r JOIN author ON author.id = r.author_id
    WHERE r.reply_parent_id IS NOT NULL AND r.deleted_at IS NULL AND r.removed_at IS NULL
    GROUP BY r.reply_parent_id
  )
  UPDATE posts p SET reply_count = p.reply_count - d.n FROM d WHERE p.id = d.post_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- A reply deleted by its author, taken down by a moderator, or restored.
CREATE FUNCTION replies_count_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM members m WHERE m.id = NEW.author_id AND m.active FOR SHARE;
  IF FOUND THEN
    UPDATE posts SET reply_count = reply_count + CASE WHEN NEW.deleted_at IS NULL AND NEW.removed_at IS NULL THEN 1 ELSE -1 END
    WHERE id = NEW.reply_parent_id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER replies_count_insert AFTER INSERT ON posts REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION replies_count_insert();
--> statement-breakpoint
CREATE TRIGGER replies_count_delete AFTER DELETE ON posts REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION replies_count_delete();
--> statement-breakpoint
CREATE TRIGGER replies_count_visibility AFTER UPDATE OF deleted_at, removed_at ON posts
  FOR EACH ROW WHEN (
    OLD.reply_parent_id IS NOT NULL
    AND (OLD.deleted_at IS NULL AND OLD.removed_at IS NULL) IS DISTINCT FROM (NEW.deleted_at IS NULL AND NEW.removed_at IS NULL)
  ) EXECUTE FUNCTION replies_count_visibility();
--> statement-breakpoint
-- A member suspended or reinstated: their likes and live replies leave or rejoin the counts.
CREATE FUNCTION members_active_counts() RETURNS trigger LANGUAGE plpgsql AS $$
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
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER members_active_counts AFTER UPDATE OF active ON members
  FOR EACH ROW WHEN (OLD.active IS DISTINCT FROM NEW.active) EXECUTE FUNCTION members_active_counts();
--> statement-breakpoint
-- Backfill. The triggers above already exist and hold their locks on likes,
-- posts and members until this migration commits, so no write slips between.
UPDATE posts p SET like_count = c.n
FROM (
  SELECT l.post_id, count(*)::int AS n FROM likes l JOIN members m ON m.id = l.member_id AND m.active GROUP BY l.post_id
) c
WHERE p.id = c.post_id;
--> statement-breakpoint
UPDATE posts p SET reply_count = c.n
FROM (
  SELECT r.reply_parent_id AS post_id, count(*)::int AS n FROM posts r JOIN members m ON m.id = r.author_id AND m.active
  WHERE r.reply_parent_id IS NOT NULL AND r.deleted_at IS NULL AND r.removed_at IS NULL
  GROUP BY r.reply_parent_id
) c
WHERE p.id = c.post_id;
