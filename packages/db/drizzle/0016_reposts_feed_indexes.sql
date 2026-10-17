-- The Following feed reads reposts by the viewer and everyone they follow
-- (PostsService.entries). For someone who follows many active accounts the newest
-- reposts site-wide are the quickest way to a page (reposts_created_idx); for
-- each candidate it asks whether one of them reposted the post again later, which
-- (post_id, created_at, member_id) answers without visiting the table. That index
-- also does everything reposts_post_idx did.
DROP INDEX "reposts_post_idx";--> statement-breakpoint
CREATE INDEX "reposts_post_created_idx" ON "reposts" USING btree ("post_id","created_at","member_id");--> statement-breakpoint
CREATE INDEX "reposts_created_idx" ON "reposts" USING btree ("created_at","post_id","member_id");