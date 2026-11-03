ALTER TABLE "communities" ADD COLUMN "photo_media_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "photo_media_id" uuid;--> statement-breakpoint
-- NOT VALID: media is an existing table and its community_id is new, so every row is null and there is nothing to check.
ALTER TABLE "media" ADD CONSTRAINT "media_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
-- NOT VALID: reports is an existing table and its community_id is new, so every row is null and there is nothing to check.
ALTER TABLE "reports" ADD CONSTRAINT "reports_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action NOT VALID;