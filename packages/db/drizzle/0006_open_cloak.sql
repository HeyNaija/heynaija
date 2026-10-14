ALTER TABLE "media" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "alt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_post_idx" ON "media" USING btree ("post_id");