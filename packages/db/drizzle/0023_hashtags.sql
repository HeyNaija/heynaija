CREATE TABLE "post_hashtags" (
	"post_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"start" integer NOT NULL,
	"length" integer NOT NULL,
	CONSTRAINT "post_hashtags_post_id_start_pk" PRIMARY KEY("post_id","start")
);
--> statement-breakpoint
ALTER TABLE "post_hashtags" ADD CONSTRAINT "post_hashtags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_hashtags_tag_idx" ON "post_hashtags" USING btree ("tag","post_id");