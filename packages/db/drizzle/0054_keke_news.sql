-- Keke's daily news (docs/adr/0030): one draft a day, Nigerian time, that a site
-- moderator approves, edits or skips before it is posted in Naija Today. New and
-- empty; nothing writes to it while the kekeNews flag is off.
CREATE TABLE "keke_news_drafts" (
	"day" date PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"stories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"items" integer DEFAULT 0 NOT NULL,
	"outlets" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"post_id" uuid,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "keke_news_drafts" ADD CONSTRAINT "keke_news_drafts_decided_by_members_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keke_news_drafts" ADD CONSTRAINT "keke_news_drafts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;