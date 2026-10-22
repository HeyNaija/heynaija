CREATE TABLE "identity_migration_rows" (
	"run_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"subject" text NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_migration_rows_run_id_provider_id_subject_pk" PRIMARY KEY("run_id","provider_id","subject")
);
--> statement-breakpoint
CREATE TABLE "identity_migration_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"status" text NOT NULL,
	"backup_ref" text NOT NULL,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cutover_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_identities" (
	"provider_id" text NOT NULL,
	"subject" text NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_identities_provider_id_subject_pk" PRIMARY KEY("provider_id","subject")
);
--> statement-breakpoint
ALTER TABLE "members" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "identity_migration_rows" ADD CONSTRAINT "identity_migration_rows_run_id_identity_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."identity_migration_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_migration_rows" ADD CONSTRAINT "identity_migration_rows_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_identities" ADD CONSTRAINT "provider_identities_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_migration_rows_member_idx" ON "identity_migration_rows" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "provider_identities_member_idx" ON "provider_identities" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_handle_unique_idx" ON "members" USING btree ("handle");