CREATE SCHEMA "games";
--> statement-breakpoint
CREATE TABLE "games"."competition_entries" (
	"competition_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"placement" integer,
	"score" integer,
	CONSTRAINT "competition_entries_competition_id_member_id_pk" PRIMARY KEY("competition_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "games"."competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"eligibility" text NOT NULL,
	"community_id" uuid,
	"entry_opens_at" timestamp with time zone NOT NULL,
	"entry_closes_at" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"standings_source" text NOT NULL,
	"created_by" uuid NOT NULL,
	"result_post_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitions_eligibility_check" CHECK (eligibility in ('open', 'community', 'invite')),
	CONSTRAINT "competitions_status_check" CHECK (status in ('draft', 'open', 'live', 'finished', 'cancelled')),
	CONSTRAINT "competitions_community_check" CHECK ((eligibility = 'community') = (community_id is not null)),
	CONSTRAINT "competitions_schedule_check" CHECK (entry_closes_at >= entry_opens_at and ends_at > starts_at)
);
--> statement-breakpoint
CREATE TABLE "games"."game_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text NOT NULL,
	"kind" text NOT NULL,
	"member_id" uuid,
	"competition_id" uuid,
	"post_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games"."game_profiles" (
	"member_id" uuid NOT NULL,
	"game" text NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_profiles_member_id_game_pk" PRIMARY KEY("member_id","game")
);
--> statement-breakpoint
CREATE TABLE "games"."seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "seasons_slug_unique" UNIQUE("slug"),
	CONSTRAINT "seasons_range_check" CHECK (ends_at > starts_at)
);
--> statement-breakpoint
CREATE TABLE "games"."season_scores" (
	"season_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"game" text NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_scores_season_id_member_id_game_pk" PRIMARY KEY("season_id","member_id","game")
);
--> statement-breakpoint
ALTER TABLE "games"."competition_entries" ADD CONSTRAINT "competition_entries_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "games"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."competition_entries" ADD CONSTRAINT "competition_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."competitions" ADD CONSTRAINT "competitions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."competitions" ADD CONSTRAINT "competitions_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."competitions" ADD CONSTRAINT "competitions_result_post_id_posts_id_fk" FOREIGN KEY ("result_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."game_events" ADD CONSTRAINT "game_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."game_events" ADD CONSTRAINT "game_events_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "games"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."game_events" ADD CONSTRAINT "game_events_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."game_profiles" ADD CONSTRAINT "game_profiles_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."season_scores" ADD CONSTRAINT "season_scores_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "games"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."season_scores" ADD CONSTRAINT "season_scores_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competition_entries_member_idx" ON "games"."competition_entries" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "competitions_status_starts_idx" ON "games"."competitions" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "game_events_member_created_idx" ON "games"."game_events" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "game_events_game_created_idx" ON "games"."game_events" USING btree ("game","created_at");--> statement-breakpoint
CREATE INDEX "season_scores_rank_idx" ON "games"."season_scores" USING btree ("season_id","game","points" DESC NULLS LAST);