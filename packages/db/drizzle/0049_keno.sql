CREATE TABLE "games"."keno_rounds" (
	"number" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "games"."keno_rounds_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"draws_at" timestamp with time zone NOT NULL,
	"seed_hash" text NOT NULL,
	"seed_sealed" text NOT NULL,
	"seed" text,
	"numbers" smallint[],
	"drawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keno_rounds_draws_at_unique" UNIQUE("draws_at"),
	CONSTRAINT "keno_rounds_drawn_check" CHECK ((drawn_at is null) = (seed is null) and (drawn_at is null) = (numbers is null)),
	CONSTRAINT "keno_rounds_numbers_check" CHECK (numbers is null or cardinality(numbers) = 20)
);
--> statement-breakpoint
CREATE TABLE "games"."keno_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"numbers" smallint[] NOT NULL,
	"table_version" text NOT NULL,
	"hits" integer,
	"points" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keno_tickets_numbers_check" CHECK (cardinality(numbers) between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "games"."keno_tickets" ADD CONSTRAINT "keno_tickets_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."keno_tickets" ADD CONSTRAINT "keno_tickets_round_number_keno_rounds_number_fk" FOREIGN KEY ("round_number") REFERENCES "games"."keno_rounds"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "keno_rounds_undrawn_idx" ON "games"."keno_rounds" USING btree ("draws_at") WHERE drawn_at is null;--> statement-breakpoint
CREATE INDEX "keno_tickets_member_idx" ON "games"."keno_tickets" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "keno_tickets_round_idx" ON "games"."keno_tickets" USING btree ("round_number");--> statement-breakpoint
-- allow-breaking: games.game_profiles is tiny (Games is dark in production) and Keno has no rows yet, so the brief write lock is harmless
CREATE INDEX "game_profiles_keno_points_idx" ON "games"."game_profiles" USING btree (((stats->>'points')::int) desc) WHERE game = 'keno';