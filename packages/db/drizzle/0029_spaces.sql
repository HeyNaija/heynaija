CREATE TABLE "space_members" (
	"space_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text DEFAULT 'listener' NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"speak_requested_at" timestamp with time zone,
	"role_changed_by" uuid,
	"role_changed_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "space_members_space_id_member_id_pk" PRIMARY KEY("space_id","member_id"),
	CONSTRAINT "space_members_role_check" CHECK (role in ('host', 'cohost', 'speaker', 'listener'))
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"community_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"peak_listeners" integer DEFAULT 0 NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"listener_cap" integer,
	"requests_open" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_status_check" CHECK (status in ('scheduled', 'live', 'ended')),
	CONSTRAINT "spaces_title_check" CHECK (char_length("spaces"."title") between 1 and 120),
	CONSTRAINT "spaces_listener_cap_check" CHECK ("spaces"."listener_cap" is null or "spaces"."listener_cap" between 1 and 10000)
);
--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_role_changed_by_members_id_fk" FOREIGN KEY ("role_changed_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_removed_by_members_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_host_id_members_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_members_member_idx" ON "space_members" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_one_live_per_host_idx" ON "spaces" USING btree ("host_id") WHERE status = 'live';--> statement-breakpoint
CREATE INDEX "spaces_status_idx" ON "spaces" USING btree ("status","started_at");