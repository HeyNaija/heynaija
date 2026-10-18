CREATE TABLE "post_mentions" (
	"post_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"start" integer NOT NULL,
	"length" integer NOT NULL,
	CONSTRAINT "post_mentions_post_id_start_pk" PRIMARY KEY("post_id","start")
);
--> statement-breakpoint
ALTER TABLE "post_mentions" ADD CONSTRAINT "post_mentions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_mentions" ADD CONSTRAINT "post_mentions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_mentions_member_idx" ON "post_mentions" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_mention_once_idx" ON "notifications" USING btree ("recipient_id","actor_id","post_id") WHERE kind = 'mention';