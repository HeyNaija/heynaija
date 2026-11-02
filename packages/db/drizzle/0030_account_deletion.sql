CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_by" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"handled_by" uuid,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "privacy_requests_kind_check" CHECK (kind in ('deletion', 'access', 'correction', 'objection', 'other')),
	CONSTRAINT "privacy_requests_channel_check" CHECK (channel in ('self_service', 'email')),
	CONSTRAINT "privacy_requests_status_check" CHECK (status in ('received', 'verifying', 'in_progress', 'completed', 'cancelled', 'refused')),
	CONSTRAINT "privacy_requests_closed_check" CHECK ((status in ('completed', 'cancelled', 'refused')) = (closed_at is not null))
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deletion_scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_handled_by_members_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_requests_status_due_idx" ON "privacy_requests" USING btree ("status","due_by");--> statement-breakpoint
-- allow-breaking: members has one row per account of an invite-only pilot, so building this blocks writes only briefly, and the index starts empty: no deletion has been requested yet.
CREATE INDEX "members_deletion_due_idx" ON "members" USING btree ("deletion_scheduled_for") WHERE deletion_scheduled_for is not null and deleted_at is null;