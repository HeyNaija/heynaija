CREATE TABLE "released_handles" (
	"handle" text PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "released_handles" ADD CONSTRAINT "released_handles_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;