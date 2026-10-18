CREATE TABLE "notification_opt_outs" (
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_opt_outs_member_id_kind_pk" PRIMARY KEY("member_id","kind"),
	CONSTRAINT "notification_opt_outs_kind_check" CHECK (kind in ('reply', 'like', 'repost', 'quote', 'mention', 'follow'))
);
--> statement-breakpoint
ALTER TABLE "notification_opt_outs" ADD CONSTRAINT "notification_opt_outs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;