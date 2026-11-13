-- A post's mark can also come from its community (ADR 0020, question 8), so the
-- check on posts.adult_label takes 'community' too. The wider check goes on NOT
-- VALID, so it does not scan posts under lock: every row already passes it, as it
-- allows all the old one did. A later release may VALIDATE CONSTRAINT it.
-- allow-breaking: the previous release writes only 'author', 'moderator' or null, which the wider check that replaces this one in the same transaction still allows.
ALTER TABLE "posts" DROP CONSTRAINT "posts_adult_label_check";--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_adult_label_check" CHECK (adult_label in ('author', 'moderator', 'community')) NOT VALID;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "adult_only" boolean DEFAULT false NOT NULL;
