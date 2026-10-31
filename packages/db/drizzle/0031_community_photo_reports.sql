ALTER TABLE "reports" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "photo_media_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;