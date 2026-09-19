CREATE TABLE "ai_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"conversation_id" integer,
	"scene" varchar(20),
	"model" varchar(60) NOT NULL,
	"kind" varchar(20) DEFAULT 'chat' NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"price_version" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_aiusage_user" ON "ai_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_aiusage_conv" ON "ai_usage" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_aiusage_created" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_aiusage_model" ON "ai_usage" USING btree ("model");