CREATE TABLE "link_previews" (
	"url" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text,
	"description" text,
	"site_name" text,
	"image_id" uuid,
	"image_width" integer,
	"image_height" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "animated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "link_url" text;--> statement-breakpoint
CREATE INDEX "link_previews_requested_idx" ON "link_previews" USING btree ("requested_at");