CREATE INDEX "notifications_actor_idx" ON "notifications" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "notifications_post_idx" ON "notifications" USING btree ("post_id");