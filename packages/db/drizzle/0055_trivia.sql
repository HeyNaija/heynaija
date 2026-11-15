CREATE TABLE "games"."trivia_answers" (
	"question_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"choice" smallint,
	"text" text,
	"normalised" text,
	"correct" boolean,
	"accepted_by" uuid,
	"answered_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "games"."trivia_answers_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"place" integer,
	"points" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "trivia_answers_question_id_member_id_pk" PRIMARY KEY("question_id","member_id"),
	CONSTRAINT "trivia_answers_one_kind_check" CHECK ((choice is null) <> (text is null))
);
--> statement-breakpoint
CREATE TABLE "games"."trivia_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"choices" text[],
	"correct_choice" smallint,
	"accepted" text[],
	"explanation" text,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"judged_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"reveal_post_id" uuid,
	"firsts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answered" integer DEFAULT 0 NOT NULL,
	"right_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "trivia_questions_round_position_unique" UNIQUE("round_id","position"),
	CONSTRAINT "trivia_questions_kind_check" CHECK (kind in ('choice', 'typed')),
	CONSTRAINT "trivia_questions_answer_check" CHECK ((kind = 'choice' and cardinality(choices) between 2 and 4 and correct_choice between 0 and cardinality(choices) - 1) or (kind = 'typed' and cardinality(accepted) >= 1) or prompt = ''),
	CONSTRAINT "trivia_questions_window_check" CHECK ((opens_at is null) = (closes_at is null) and (closes_at is null or closes_at > opens_at))
);
--> statement-breakpoint
CREATE TABLE "games"."trivia_results" (
	"round_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"right_count" integer NOT NULL,
	"firsts" integer NOT NULL,
	"time_ms" integer NOT NULL,
	"place" integer NOT NULL,
	CONSTRAINT "trivia_results_round_id_member_id_pk" PRIMARY KEY("round_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "games"."trivia_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"community_id" uuid,
	"title" text NOT NULL,
	"format" text DEFAULT 'live' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"seconds_per_question" integer DEFAULT 20 NOT NULL,
	"auto_advance" boolean DEFAULT false NOT NULL,
	"thread_post_id" uuid,
	"result_post_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trivia_rounds_status_check" CHECK (status in ('draft', 'scheduled', 'live', 'reviewing', 'published', 'cancelled')),
	CONSTRAINT "trivia_rounds_format_check" CHECK (format in ('live')),
	CONSTRAINT "trivia_rounds_seconds_check" CHECK (seconds_per_question between 10 and 60)
);
--> statement-breakpoint
ALTER TABLE "games"."trivia_answers" ADD CONSTRAINT "trivia_answers_question_id_trivia_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "games"."trivia_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."trivia_answers" ADD CONSTRAINT "trivia_answers_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."trivia_answers" ADD CONSTRAINT "trivia_answers_round_id_trivia_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "games"."trivia_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."trivia_questions" ADD CONSTRAINT "trivia_questions_round_id_trivia_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "games"."trivia_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."trivia_results" ADD CONSTRAINT "trivia_results_round_id_trivia_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "games"."trivia_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."trivia_results" ADD CONSTRAINT "trivia_results_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."trivia_rounds" ADD CONSTRAINT "trivia_rounds_host_id_members_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games"."trivia_rounds" ADD CONSTRAINT "trivia_rounds_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trivia_answers_member_idx" ON "games"."trivia_answers" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "trivia_answers_round_idx" ON "games"."trivia_answers" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "trivia_questions_due_idx" ON "games"."trivia_questions" USING btree ("closes_at") WHERE judged_at is null and closes_at is not null;--> statement-breakpoint
CREATE INDEX "trivia_results_member_idx" ON "games"."trivia_results" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "trivia_rounds_status_idx" ON "games"."trivia_rounds" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "trivia_rounds_host_idx" ON "games"."trivia_rounds" USING btree ("host_id");