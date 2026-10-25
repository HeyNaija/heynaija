ALTER TABLE "communities" ADD COLUMN "pinned_post_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "pinned_post_id" uuid;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_pinned_post_id_posts_id_fk" FOREIGN KEY ("pinned_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_pinned_post_id_posts_id_fk" FOREIGN KEY ("pinned_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;