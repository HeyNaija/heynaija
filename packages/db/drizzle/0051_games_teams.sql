CREATE TABLE "games"."community_teams" (
	"community_id" uuid PRIMARY KEY NOT NULL,
	"lichess_team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"nb_members" integer DEFAULT 0 NOT NULL,
	"linked_by" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_teams_lichess_team_id_unique" UNIQUE("lichess_team_id")
);
--> statement-breakpoint
ALTER TABLE "games"."competition_entries" ADD COLUMN "source_rank" integer;--> statement-breakpoint
ALTER TABLE "games"."competitions" ADD COLUMN "lichess_tournament_id" text;--> statement-breakpoint
ALTER TABLE "games"."competitions" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "games"."competitions" ADD COLUMN "standings_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "games"."lichess_link_attempts" ADD COLUMN "scopes" text DEFAULT 'challenge:read challenge:write board:play' NOT NULL;--> statement-breakpoint
ALTER TABLE "games"."community_teams" ADD CONSTRAINT "community_teams_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."community_teams" ADD CONSTRAINT "community_teams_linked_by_members_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- allow-breaking: the games tables are small (Games is dark in production), so the brief write lock is harmless
CREATE UNIQUE INDEX "competitions_lichess_tournament_idx" ON "games"."competitions" USING btree ("lichess_tournament_id") WHERE lichess_tournament_id is not null;--> statement-breakpoint
-- allow-breaking: the games tables are small (Games is dark in production) and no chess competition exists yet, so the scan is brief and the old release never writes one
ALTER TABLE "games"."competitions" ADD CONSTRAINT "competitions_chess_check" CHECK (game <> 'chess' or (lichess_tournament_id is not null and eligibility = 'community'));