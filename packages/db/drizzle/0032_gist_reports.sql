CREATE TABLE "gist_report_participants" (
	"report_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "gist_report_participants_report_id_member_id_pk" PRIMARY KEY("report_id","member_id"),
	CONSTRAINT "gist_report_participants_role_check" CHECK (role in ('host', 'cohost', 'speaker', 'listener'))
);
--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD COLUMN "gist_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "gist_id" uuid;--> statement-breakpoint
ALTER TABLE "gist_report_participants" ADD CONSTRAINT "gist_report_participants_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gist_report_participants" ADD CONSTRAINT "gist_report_participants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- NOT VALID: moderation_actions is an existing table and its gist_id is new, so every row is null and there is nothing to check.
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_gist_id_gists_id_fk" FOREIGN KEY ("gist_id") REFERENCES "public"."gists"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
-- NOT VALID: reports is an existing table and its gist_id is new, so every row is null and there is nothing to check.
ALTER TABLE "reports" ADD CONSTRAINT "reports_gist_id_gists_id_fk" FOREIGN KEY ("gist_id") REFERENCES "public"."gists"("id") ON DELETE no action ON UPDATE no action NOT VALID;