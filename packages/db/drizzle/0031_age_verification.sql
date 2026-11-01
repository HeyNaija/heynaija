CREATE TABLE "restricted"."age_verifications" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"method" text,
	"verified_at" timestamp with time zone,
	"didit_session_id" text NOT NULL,
	"person_key" text,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restricted"."age_verifications" ADD CONSTRAINT "age_verifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "age_verifications_person_idx" ON "restricted"."age_verifications" USING btree ("person_key") WHERE status = 'verified' and person_key is not null;