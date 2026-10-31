CREATE TABLE "meeting_participants" (
	"meeting_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"sid" text,
	CONSTRAINT "meeting_participants_meeting_id_member_id_pk" PRIMARY KEY("meeting_id","member_id"),
	CONSTRAINT "meeting_participants_status_check" CHECK (status in ('invited', 'joined', 'left', 'declined', 'missed', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "meetings_status_check" CHECK (status in ('open', 'ended'))
);
--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_host_id_members_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_participants_one_joined_idx" ON "meeting_participants" USING btree ("member_id") WHERE status = 'joined';--> statement-breakpoint
CREATE INDEX "meeting_participants_invited_idx" ON "meeting_participants" USING btree ("member_id","invited_at") WHERE status = 'invited';--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_one_open_per_host_idx" ON "meetings" USING btree ("host_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "meetings_open_idx" ON "meetings" USING btree ("created_at") WHERE status = 'open';