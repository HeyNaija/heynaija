-- Community announcements (docs/adr/0029): a moderator may notify every member
-- of a community about a new post in it, once a day. `announced_at` is when the
-- community's last one went; `announcements` is a member's choice to be told,
-- on until they turn it off for that community. Adding these notifies nobody:
-- posting one is behind the communityAnnouncements flag.
ALTER TABLE "communities" ADD COLUMN "announced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "announcements" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- allow-breaking: the check comes straight back below with one more kind, in this same transaction, so nothing the previous release writes is ever unchecked or refused
ALTER TABLE "notification_opt_outs" DROP CONSTRAINT "notification_opt_outs_kind_check";--> statement-breakpoint
-- NOT VALID: every existing row holds one of the kinds allowed before, all of which are still allowed, so there is nothing to check.
ALTER TABLE "notification_opt_outs" ADD CONSTRAINT "notification_opt_outs_kind_check" CHECK (kind in ('reply', 'like', 'repost', 'quote', 'mention', 'follow', 'story_update', 'chess_challenge', 'chess_game_started', 'community_announcement')) NOT VALID;
