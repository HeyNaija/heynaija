-- Weekly highlights (docs/adr/0027): whether a member wants them (on until they
-- turn it off, like every other kind of message), when the weekly run last dealt
-- with them, and when it last sent them any. Nothing is sent to anyone by adding
-- these: the run is behind the weeklyHighlights flag, and it only writes to a
-- member who has been away, by push where they turned push on and by email only
-- where email is already on.
ALTER TABLE "members" ADD COLUMN "weekly_highlights" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "highlights_settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "highlights_sent_at" timestamp with time zone;
