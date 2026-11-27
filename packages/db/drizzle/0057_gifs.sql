ALTER TABLE "posts" ADD COLUMN "gif_provider" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "gif_id" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "gif_alt" text;--> statement-breakpoint
-- NOT VALID: posts is an existing table and its gif columns are new, so every row is null and there is nothing to check.
ALTER TABLE "posts" ADD CONSTRAINT "posts_gif_check" CHECK ((gif_provider is null) = (gif_id is null) and (gif_alt is null or gif_id is not null) and (gif_provider is null or (gif_provider ~ '^[a-z][a-z0-9]{0,19}$' and gif_id ~ '^[A-Za-z0-9_-]{1,64}$'))) NOT VALID;