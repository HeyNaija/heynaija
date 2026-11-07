-- IF NOT EXISTS: this was 0040 on its branch before stories took that number, and the shared dev database already has it.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "served_privately" boolean DEFAULT false NOT NULL;
