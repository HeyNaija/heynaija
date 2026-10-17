CREATE SCHEMA "restricted";
--> statement-breakpoint
CREATE TABLE "restricted"."age_assurances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"band" text NOT NULL,
	"method" text NOT NULL,
	"verification_id" uuid,
	"recorded_by" uuid,
	"review_after" timestamp with time zone,
	"assured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "restricted"."governance_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"actor_id" uuid,
	"event" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restricted"."governance_memberships" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"opted_in_at" timestamp with time zone NOT NULL,
	"documents_version" text NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_until" timestamp with time zone,
	"suspension_reason" text
);
--> statement-breakpoint
CREATE TABLE "restricted"."identity_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"person_key" text,
	"consent_version" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"revoked_at" timestamp with time zone,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_badges" (
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "profile_badges_member_id_kind_pk" PRIMARY KEY("member_id","kind")
);
--> statement-breakpoint
ALTER TABLE "restricted"."age_assurances" ADD CONSTRAINT "age_assurances_verification_id_identity_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "restricted"."identity_verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricted"."governance_memberships" ADD CONSTRAINT "governance_memberships_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricted"."identity_verifications" ADD CONSTRAINT "identity_verifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricted"."identity_verifications" ADD CONSTRAINT "identity_verifications_reviewed_by_members_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_badges" ADD CONSTRAINT "profile_badges_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "age_assurances_member_idx" ON "restricted"."age_assurances" USING btree ("member_id","assured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "age_assurances_one_declaration_idx" ON "restricted"."age_assurances" USING btree ("member_id") WHERE method = 'self_declared' and withdrawn_at is null;--> statement-breakpoint
CREATE INDEX "governance_audit_log_subject_idx" ON "restricted"."governance_audit_log" USING btree ("subject_id","created_at");--> statement-breakpoint
CREATE INDEX "identity_verifications_member_idx" ON "restricted"."identity_verifications" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_verifications_live_member_idx" ON "restricted"."identity_verifications" USING btree ("member_id") WHERE status in ('pending', 'verified');--> statement-breakpoint
CREATE UNIQUE INDEX "identity_verifications_person_idx" ON "restricted"."identity_verifications" USING btree ("provider","person_key") WHERE status = 'verified' and person_key is not null;