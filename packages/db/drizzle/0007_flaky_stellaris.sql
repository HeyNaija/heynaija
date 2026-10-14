ALTER TABLE "members" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "bio" text DEFAULT '' NOT NULL;