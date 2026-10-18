ALTER TABLE "members" ADD COLUMN "email_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "last_notification_email_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_settled_at" timestamp with time zone;--> statement-breakpoint
-- Everyone already here joined when notifications were in the app only, and was
-- never asked about email. They start with it off (members who join from now on,
-- new rows, start with it on) and can turn it on in Settings. Mail from a new
-- sender to people who did not expect it is also what gets a sending domain
-- marked as spam, and the sign-in codes use the same domain.
UPDATE "members" SET "email_notifications" = false;--> statement-breakpoint
-- Nothing that happened before email existed is ever emailed.
UPDATE "notifications" SET "email_settled_at" = now();--> statement-breakpoint
CREATE INDEX "notifications_email_pending_idx" ON "notifications" USING btree ("recipient_id","created_at") WHERE email_settled_at is null;
