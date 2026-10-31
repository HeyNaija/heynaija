CREATE TABLE "gist_members" (
	"gist_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text DEFAULT 'listener' NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"connection_sid" text,
	"speak_requested_at" timestamp with time zone,
	"role_changed_by" uuid,
	"role_changed_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "gist_members_gist_id_member_id_pk" PRIMARY KEY("gist_id","member_id"),
	CONSTRAINT "gist_members_role_check" CHECK (role in ('host', 'cohost', 'speaker', 'listener'))
);
--> statement-breakpoint
CREATE TABLE "gists" (
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
	CONSTRAINT "gists_status_check" CHECK (status in ('scheduled', 'live', 'ended')),
	CONSTRAINT "gists_title_check" CHECK (char_length("gists"."title") between 1 and 120),
	CONSTRAINT "gists_listener_cap_check" CHECK ("gists"."listener_cap" is null or "gists"."listener_cap" between 1 and 10000)
);
--> statement-breakpoint
ALTER TABLE "gist_members" ADD CONSTRAINT "gist_members_gist_id_gists_id_fk" FOREIGN KEY ("gist_id") REFERENCES "public"."gists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gist_members" ADD CONSTRAINT "gist_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gist_members" ADD CONSTRAINT "gist_members_role_changed_by_members_id_fk" FOREIGN KEY ("role_changed_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gist_members" ADD CONSTRAINT "gist_members_removed_by_members_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gists" ADD CONSTRAINT "gists_host_id_members_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gists" ADD CONSTRAINT "gists_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gist_members_member_idx" ON "gist_members" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gists_one_live_per_host_idx" ON "gists" USING btree ("host_id") WHERE status = 'live';--> statement-breakpoint
CREATE INDEX "gists_status_idx" ON "gists" USING btree ("status","started_at");