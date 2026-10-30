CREATE TABLE "poll_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "poll_options_post_id_unique" UNIQUE("post_id","id"),
	CONSTRAINT "poll_options_position_check" CHECK ("poll_options"."position" between 0 and 9),
	CONSTRAINT "poll_options_text_check" CHECK (char_length("poll_options"."text") between 1 and 1280)
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"post_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_post_id_member_id_option_id_pk" PRIMARY KEY("post_id","member_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "post_polls" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"multiple" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voter_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "post_polls_expiry_check" CHECK ("post_polls"."expires_at" is null or "post_polls"."expires_at" > "post_polls"."created_at")
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "reply_audience" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_post_id_post_polls_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post_polls"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_post_id_option_id_poll_options_post_id_id_fk" FOREIGN KEY ("post_id","option_id") REFERENCES "public"."poll_options"("post_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_polls" ADD CONSTRAINT "post_polls_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_options_post_position_idx" ON "poll_options" USING btree ("post_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_options_post_text_idx" ON "poll_options" USING btree ("post_id",lower("text"));--> statement-breakpoint
CREATE INDEX "poll_votes_option_idx" ON "poll_votes" USING btree ("post_id","option_id");--> statement-breakpoint
CREATE INDEX "poll_votes_member_idx" ON "poll_votes" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "poll_votes_ballot_idx" ON "poll_votes" USING btree ("post_id","created_at","member_id");--> statement-breakpoint
-- NOT VALID: checking the posts already there would scan the table under lock,
-- and they all hold the column's default. New and updated rows are checked;
-- VALIDATE CONSTRAINT in a later release.
ALTER TABLE "posts" ADD CONSTRAINT "posts_reply_audience_check" CHECK (reply_audience in ('everyone', 'following', 'mentioned')) NOT VALID;--> statement-breakpoint
-- post_polls.voter_count and poll_options.vote_count are kept by the triggers
-- below, as posts.like_count is (migration 0011), so readers never count ballots
-- row by row. Only active members' votes count; suspending or reinstating a member
-- moves theirs out of or back into the counts. A voter joins a poll's count with
-- their first vote on it and leaves with their last, however many options they
-- chose and whichever statements those arrive in.
CREATE FUNCTION poll_votes_count_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH voter AS (
    SELECT m.id FROM members m WHERE m.id IN (SELECT member_id FROM new_rows) AND m.active FOR SHARE
  ), d AS (
    SELECT v.option_id, count(*)::int AS n FROM new_rows v JOIN voter ON voter.id = v.member_id GROUP BY v.option_id
  )
  UPDATE poll_options po SET vote_count = po.vote_count + d.n FROM d WHERE po.id = d.option_id;
  WITH d AS (
    SELECT b.post_id, count(*)::int AS n
    FROM (SELECT DISTINCT post_id, member_id FROM new_rows) b
    JOIN members m ON m.id = b.member_id AND m.active
    WHERE NOT EXISTS (
      SELECT 1 FROM poll_votes pv
      WHERE pv.post_id = b.post_id AND pv.member_id = b.member_id
        AND NOT EXISTS (
          SELECT 1 FROM new_rows n WHERE n.post_id = pv.post_id AND n.member_id = pv.member_id AND n.option_id = pv.option_id
        )
    )
    GROUP BY b.post_id
  )
  UPDATE post_polls pp SET voter_count = pp.voter_count + d.n FROM d WHERE pp.post_id = d.post_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION poll_votes_count_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH voter AS (
    SELECT m.id FROM members m WHERE m.id IN (SELECT member_id FROM old_rows) AND m.active FOR SHARE
  ), d AS (
    SELECT v.option_id, count(*)::int AS n FROM old_rows v JOIN voter ON voter.id = v.member_id GROUP BY v.option_id
  )
  UPDATE poll_options po SET vote_count = po.vote_count - d.n FROM d WHERE po.id = d.option_id;
  WITH d AS (
    SELECT b.post_id, count(*)::int AS n
    FROM (SELECT DISTINCT post_id, member_id FROM old_rows) b
    JOIN members m ON m.id = b.member_id AND m.active
    WHERE NOT EXISTS (SELECT 1 FROM poll_votes pv WHERE pv.post_id = b.post_id AND pv.member_id = b.member_id)
    GROUP BY b.post_id
  )
  UPDATE post_polls pp SET voter_count = pp.voter_count - d.n FROM d WHERE pp.post_id = d.post_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER poll_votes_count_insert AFTER INSERT ON poll_votes REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION poll_votes_count_insert();
--> statement-breakpoint
CREATE TRIGGER poll_votes_count_delete AFTER DELETE ON poll_votes REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION poll_votes_count_delete();
--> statement-breakpoint
-- A member suspended or reinstated: their votes leave or rejoin the counts.
-- Separate from members_active_counts (migration 0015), which keeps posts' counts.
CREATE FUNCTION members_active_poll_counts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  delta int := CASE WHEN NEW.active THEN 1 ELSE -1 END;
BEGIN
  UPDATE poll_options po SET vote_count = po.vote_count + delta * d.n
  FROM (SELECT option_id, count(*)::int AS n FROM poll_votes WHERE member_id = NEW.id GROUP BY option_id) d
  WHERE po.id = d.option_id;
  UPDATE post_polls pp SET voter_count = pp.voter_count + delta
  FROM (SELECT DISTINCT post_id FROM poll_votes WHERE member_id = NEW.id) d
  WHERE pp.post_id = d.post_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER members_active_poll_counts AFTER UPDATE OF active ON members
  FOR EACH ROW WHEN (OLD.active IS DISTINCT FROM NEW.active) EXECUTE FUNCTION members_active_poll_counts();
