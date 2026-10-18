ALTER TABLE "members" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
-- Everyone already here has found their way around without the welcome flow,
-- so only members who join from now on (new rows, which start null) are sent
-- through it.
UPDATE "members" SET "onboarded_at" = now() WHERE "onboarded_at" IS NULL;
