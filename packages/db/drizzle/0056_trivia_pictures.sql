ALTER TABLE "games"."trivia_questions" ADD COLUMN "image_id" uuid;--> statement-breakpoint
ALTER TABLE "games"."trivia_questions" ADD COLUMN "image_alt" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Every existing row has no picture, so there is nothing to validate; new rows are checked.
ALTER TABLE "games"."trivia_questions" ADD CONSTRAINT "trivia_questions_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
-- allow-breaking: the games tables are small (Games is dark in production), so the brief write lock is harmless
CREATE INDEX "trivia_questions_image_idx" ON "games"."trivia_questions" USING btree ("image_id") WHERE image_id is not null;
