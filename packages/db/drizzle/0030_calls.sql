CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caller_id" uuid NOT NULL,
	"callee_id" uuid NOT NULL,
	"status" text DEFAULT 'ringing' NOT NULL,
	"ring_expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"caller_sid" text,
	"callee_sid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_status_check" CHECK (status in ('ringing', 'active', 'ended', 'missed', 'declined')),
	CONSTRAINT "calls_parties_check" CHECK ("calls"."caller_id" <> "calls"."callee_id")
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "allow_calls" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_caller_id_members_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_callee_id_members_id_fk" FOREIGN KEY ("callee_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calls_one_open_per_caller_idx" ON "calls" USING btree ("caller_id") WHERE status in ('ringing', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "calls_one_open_per_callee_idx" ON "calls" USING btree ("callee_id") WHERE status in ('ringing', 'active');--> statement-breakpoint
CREATE INDEX "calls_callee_idx" ON "calls" USING btree ("callee_id","created_at");