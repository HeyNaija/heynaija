CREATE TABLE "games"."competition_invites" (
	"competition_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	CONSTRAINT "competition_invites_competition_id_member_id_pk" PRIMARY KEY("competition_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "games"."xp_totals" (
	"member_id" uuid NOT NULL,
	"period" text NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_totals_member_id_period_pk" PRIMARY KEY("member_id","period")
);
--> statement-breakpoint
ALTER TABLE "games"."game_events" ADD COLUMN "xp" integer;--> statement-breakpoint
ALTER TABLE "games"."competition_invites" ADD CONSTRAINT "competition_invites_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "games"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."competition_invites" ADD CONSTRAINT "competition_invites_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."xp_totals" ADD CONSTRAINT "xp_totals_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competition_invites_member_idx" ON "games"."competition_invites" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "xp_totals_rank_idx" ON "games"."xp_totals" USING btree ("period","xp" DESC NULLS LAST);--> statement-breakpoint
-- allow-breaking: the games tables are small (Games is dark in production), so the brief write lock is harmless
CREATE INDEX "game_events_unscored_idx" ON "games"."game_events" USING btree ("created_at") WHERE xp is null;--> statement-breakpoint
-- allow-breaking: the games tables are small (Games is dark in production), so the brief write lock is harmless
CREATE INDEX "season_scores_xp_idx" ON "games"."season_scores" USING btree ("season_id","game","xp" DESC NULLS LAST);