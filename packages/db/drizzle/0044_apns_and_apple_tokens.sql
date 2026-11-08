-- The iOS app's push (docs/adr/0026): Apple's service for App Store and TestFlight
-- builds, and its sandbox for builds run from Xcode. Sign in with Apple's refresh
-- tokens, kept only to revoke them when an account is erased.
CREATE TABLE "apple_tokens" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"refresh_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The service check widens to take Apple's. The new one is added NOT VALID, so it
-- does not scan push_devices under lock: every row already passes it, as it allows
-- all the old one did. A later release may VALIDATE CONSTRAINT it.
-- allow-breaking: the previous release writes only 'fcm', which the wider check that replaces this one in the same transaction still allows.
ALTER TABLE "push_devices" DROP CONSTRAINT "push_devices_service_check";--> statement-breakpoint
ALTER TABLE "apple_tokens" ADD CONSTRAINT "apple_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_service_check" CHECK (service in ('fcm', 'apns', 'apns_sandbox')) NOT VALID;