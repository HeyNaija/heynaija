CREATE TABLE "poll_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
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
ALTER TABLE "posts" ADD CONSTRAINT "posts_reply_audience_check" CHECK (reply_audience in ('everyone', 'following', 'mentioned'));