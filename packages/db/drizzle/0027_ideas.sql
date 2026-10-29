CREATE TABLE "idea_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"moderator_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idea_votes" (
	"post_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_votes_post_id_member_id_pk" PRIMARY KEY("post_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'under_review' NOT NULL,
	"status_reason" text,
	"duplicate_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ideas_kind_check" CHECK (kind in ('idea', 'problem')),
	CONSTRAINT "ideas_status_check" CHECK (status in ('under_review', 'planned', 'in_progress', 'shipped', 'not_now', 'duplicate')),
	CONSTRAINT "ideas_duplicate_check" CHECK ((status = 'duplicate') = (duplicate_of is not null) and duplicate_of is distinct from post_id)
);
--> statement-breakpoint
CREATE TABLE "problem_details" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"page" text,
	"browser" text,
	"app_version" text
);
--> statement-breakpoint
ALTER TABLE "idea_status_changes" ADD CONSTRAINT "idea_status_changes_post_id_ideas_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ideas"("post_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_status_changes" ADD CONSTRAINT "idea_status_changes_moderator_id_members_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_votes" ADD CONSTRAINT "idea_votes_post_id_ideas_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ideas"("post_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_votes" ADD CONSTRAINT "idea_votes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_duplicate_of_posts_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_details" ADD CONSTRAINT "problem_details_post_id_ideas_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ideas"("post_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idea_status_changes_post_idx" ON "idea_status_changes" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "idea_votes_member_idx" ON "idea_votes" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ideas_status_created_idx" ON "ideas" USING btree ("status","created_at");