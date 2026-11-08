ALTER TABLE "members" ADD COLUMN "label_posts" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "show_sensitive_media" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "adult_label" text;--> statement-breakpoint
-- NOT VALID: members is an existing table and its label_posts is new, so every row is null and there is nothing to check.
ALTER TABLE "members" ADD CONSTRAINT "members_label_posts_check" CHECK (label_posts in ('author', 'moderator')) NOT VALID;--> statement-breakpoint
-- NOT VALID: posts is an existing table and its adult_label is new, so every row is null and there is nothing to check.
ALTER TABLE "posts" ADD CONSTRAINT "posts_adult_label_check" CHECK (adult_label in ('author', 'moderator')) NOT VALID;
