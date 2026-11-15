-- Keke, HeyNaija's help bot (docs/adr/0030). `keke_usage` is one row for every
-- call to its model: which model, tokens, cost and outcome, for the monthly cap
-- and the numbers on /mod. It holds no member, post or text. `keke_budget_alerts`
-- is the months the cap was reached in, so the operators are emailed once.
-- Both are new and empty; nothing reads them while the keke flag is off.
CREATE TABLE "keke_budget_alerts" (
	"month" date PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keke_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"model" text NOT NULL,
	"via" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "keke_usage_created_idx" ON "keke_usage" USING btree ("created_at");