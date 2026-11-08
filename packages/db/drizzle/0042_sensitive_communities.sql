ALTER TABLE "posts" DROP CONSTRAINT "posts_adult_label_check";--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "adult_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_adult_label_check" CHECK (adult_label in ('author', 'moderator', 'community'));