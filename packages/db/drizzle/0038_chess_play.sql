CREATE TABLE "games"."chess_games" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" uuid,
	"white_id" uuid NOT NULL,
	"black_id" uuid NOT NULL,
	"rated" boolean NOT NULL,
	"clock_limit" integer,
	"clock_increment" integer,
	"days" integer,
	"status" text DEFAULT 'created' NOT NULL,
	"winner" text,
	"moves" text DEFAULT '' NOT NULL,
	"white_ms" integer,
	"black_ms" integer,
	"clock_at" timestamp with time zone,
	"draw_offer" text,
	"version" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"thread_post_id" uuid,
	"result_post_id" uuid,
	"ratings_after" jsonb,
	CONSTRAINT "chess_games_players_check" CHECK (white_id <> black_id)
);
--> statement-breakpoint
-- allow-breaking: widens the opt-out kinds to add chess_game_started; recreated below with every old kind
ALTER TABLE "notification_opt_outs" DROP CONSTRAINT "notification_opt_outs_kind_check";--> statement-breakpoint
ALTER TABLE "games"."chess_challenges" ADD COLUMN "open_thread" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "game_id" text;--> statement-breakpoint
ALTER TABLE "games"."chess_games" ADD CONSTRAINT "chess_games_challenge_id_chess_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "games"."chess_challenges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."chess_games" ADD CONSTRAINT "chess_games_white_id_members_id_fk" FOREIGN KEY ("white_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."chess_games" ADD CONSTRAINT "chess_games_black_id_members_id_fk" FOREIGN KEY ("black_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."chess_games" ADD CONSTRAINT "chess_games_thread_post_id_posts_id_fk" FOREIGN KEY ("thread_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."chess_games" ADD CONSTRAINT "chess_games_result_post_id_posts_id_fk" FOREIGN KEY ("result_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chess_games_white_idx" ON "games"."chess_games" USING btree ("white_id","finished_at");--> statement-breakpoint
CREATE INDEX "chess_games_black_idx" ON "games"."chess_games" USING btree ("black_id","finished_at");--> statement-breakpoint
CREATE INDEX "chess_games_live_idx" ON "games"."chess_games" USING btree ("started_at") WHERE finished_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "chess_games_thread_idx" ON "games"."chess_games" USING btree ("thread_post_id");--> statement-breakpoint
-- allow-breaking: the column was added just above, so every row is null and the check finds nothing to refuse; old code never writes it
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_game_id_chess_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "games"."chess_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- allow-breaking: partial (kind = chess_game_started), so it holds no rows yet; the build is one scan of notifications, which at pilot size is short
CREATE UNIQUE INDEX "notifications_game_started_once_idx" ON "notifications" USING btree ("game_id") WHERE kind = 'chess_game_started';--> statement-breakpoint
-- allow-breaking: the same check with one more kind; every existing row passes it, and the table is one row per opt-out
ALTER TABLE "notification_opt_outs" ADD CONSTRAINT "notification_opt_outs_kind_check" CHECK (kind in ('reply', 'like', 'repost', 'quote', 'mention', 'follow', 'chess_challenge', 'chess_game_started'));