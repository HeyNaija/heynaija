CREATE TABLE "games"."chess_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenger_id" uuid NOT NULL,
	"challenged_id" uuid NOT NULL,
	"rated" boolean NOT NULL,
	"clock_limit" integer,
	"clock_increment" integer,
	"days" integer,
	"color" text DEFAULT 'random' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"lichess_game_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "chess_challenges_status_check" CHECK (status in ('pending', 'accepted', 'declined', 'cancelled', 'failed')),
	CONSTRAINT "chess_challenges_color_check" CHECK (color in ('random', 'white', 'black')),
	CONSTRAINT "chess_challenges_time_check" CHECK ((clock_limit is not null and clock_increment is not null and days is null) or (clock_limit is null and clock_increment is null and days is not null)),
	CONSTRAINT "chess_challenges_self_check" CHECK (challenger_id <> challenged_id)
);
--> statement-breakpoint
CREATE TABLE "games"."lichess_accounts" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"lichess_id" text NOT NULL,
	"username" text NOT NULL,
	"token_box" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"scopes" text NOT NULL,
	"ratings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ratings_refreshed_at" timestamp with time zone,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lichess_accounts_lichess_id_unique" UNIQUE("lichess_id")
);
--> statement-breakpoint
CREATE TABLE "games"."lichess_link_attempts" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"verifier_box" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- allow-breaking: widens the opt-out kinds to add chess_challenge; recreated below with every old kind
ALTER TABLE "notification_opt_outs" DROP CONSTRAINT "notification_opt_outs_kind_check";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "challenge_id" uuid;--> statement-breakpoint
ALTER TABLE "games"."chess_challenges" ADD CONSTRAINT "chess_challenges_challenger_id_members_id_fk" FOREIGN KEY ("challenger_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."chess_challenges" ADD CONSTRAINT "chess_challenges_challenged_id_members_id_fk" FOREIGN KEY ("challenged_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."lichess_accounts" ADD CONSTRAINT "lichess_accounts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."lichess_link_attempts" ADD CONSTRAINT "lichess_link_attempts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chess_challenges_pending_pair_idx" ON "games"."chess_challenges" USING btree ("challenger_id","challenged_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "chess_challenges_challenged_idx" ON "games"."chess_challenges" USING btree ("challenged_id","status");--> statement-breakpoint
CREATE INDEX "chess_challenges_challenger_idx" ON "games"."chess_challenges" USING btree ("challenger_id","status");--> statement-breakpoint
CREATE INDEX "lichess_link_attempts_member_idx" ON "games"."lichess_link_attempts" USING btree ("member_id");--> statement-breakpoint
-- allow-breaking: the column was added just above, so every row is null and the check finds nothing to refuse; old code never writes it
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_challenge_id_chess_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "games"."chess_challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- allow-breaking: partial (kind = chess_challenge), so it holds no rows yet; the build is one scan of notifications, which at pilot size is short
CREATE UNIQUE INDEX "notifications_challenge_once_idx" ON "notifications" USING btree ("challenge_id") WHERE kind = 'chess_challenge';--> statement-breakpoint
-- allow-breaking: the same check with one more kind; every existing row passes it, and the table is one row per opt-out
ALTER TABLE "notification_opt_outs" ADD CONSTRAINT "notification_opt_outs_kind_check" CHECK (kind in ('reply', 'like', 'repost', 'quote', 'mention', 'follow', 'chess_challenge'));