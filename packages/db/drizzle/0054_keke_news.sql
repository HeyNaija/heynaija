-- Keke's daily news (docs/adr/0030). `keke_news_items` holds the headlines the
-- outlets' feeds gave, read every hour and kept 48 hours (headline, link and a short
-- description; never article text). `keke_news_drafts` is one draft a day, Nigerian
-- time, that a site moderator approves, edits or skips before it is posted in Naija
-- Today. Both new and empty; nothing writes to them while the kekeNews flag is off.
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
CREATE TABLE "keke_news_items" (
	"url" text PRIMARY KEY NOT NULL,
	"outlet" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "keke_news_drafts" ADD CONSTRAINT "keke_news_drafts_decided_by_members_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keke_news_drafts" ADD CONSTRAINT "keke_news_drafts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "keke_news_items_published_idx" ON "keke_news_items" USING btree ("published_at");