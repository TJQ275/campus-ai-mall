CREATE TABLE "ai_conversation" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"scene" varchar(20) DEFAULT 'shopping' NOT NULL,
	"title" varchar(80),
	"page_context" jsonb,
	"message_count" integer DEFAULT 0 NOT NULL,
	"rolling_summary" text,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"rating" smallint NOT NULL,
	"comment" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_knowledge" (
	"id" serial PRIMARY KEY NOT NULL,
	"scene" varchar(20) DEFAULT 'global' NOT NULL,
	"title" varchar(120) NOT NULL,
	"source" varchar(120),
	"content" text NOT NULL,
	"embedding" vector(1024),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_message" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(20) NOT NULL,
	"content_type" varchar(20) DEFAULT 'text' NOT NULL,
	"content" text,
	"cards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_call_id" varchar(64),
	"tool_name" varchar(60),
	"model" varchar(60),
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_pending_action" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"action_type" varchar(40) NOT NULL,
	"summary" varchar(200) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"result_message" text,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tool_call" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer,
	"message_id" integer,
	"user_id" integer,
	"tool_name" varchar(60) NOT NULL,
	"args" jsonb,
	"result" jsonb,
	"status" varchar(20) DEFAULT 'ok' NOT NULL,
	"error" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(40) NOT NULL,
	"slug" varchar(40) NOT NULL,
	"kind" varchar(10) NOT NULL,
	"parent_id" integer,
	"icon" varchar(200),
	"sort" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product_image" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"url" varchar(500) NOT NULL,
	"kind" varchar(20) DEFAULT 'detail' NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_sku" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"name" varchar(60) NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"condition" varchar(10),
	"seller_note" varchar(200),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_tag" (
	"product_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "product_tag_product_id_tag_id_pk" PRIMARY KEY("product_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(10) NOT NULL,
	"category_id" integer NOT NULL,
	"title" varchar(120) NOT NULL,
	"subtitle" varchar(200),
	"description" text,
	"cover" varchar(500),
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"original_price_cents" integer DEFAULT 0 NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"sales" integer DEFAULT 0 NOT NULL,
	"status" varchar(10) DEFAULT 'on' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flavor" varchar(40),
	"spicy_level" smallint,
	"spec" varchar(40),
	"shelf_life_days" integer,
	"isbn" varchar(20),
	"author" varchar(80),
	"publisher" varchar(80),
	"edition" varchar(40),
	"course" varchar(80),
	"condition" varchar(10),
	"has_notes" boolean,
	"rating_avg" real DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_summary" (
	"product_id" integer PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"pros" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" varchar(200),
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rating_dist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"model" varchar(60),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"order_item_id" integer,
	"rating" smallint DEFAULT 5 NOT NULL,
	"content" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(30) NOT NULL,
	"kind" varchar(20) DEFAULT 'other' NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "address" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"receiver" varchar(50) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"campus" varchar(60),
	"detail" varchar(200) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_behavior" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"product_id" integer,
	"type" varchar(20) NOT NULL,
	"keyword" varchar(100),
	"weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"taste" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"avoid_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget_min_cents" integer DEFAULT 0 NOT NULL,
	"budget_max_cents" integer DEFAULT 0 NOT NULL,
	"major" varchar(60),
	"grade" varchar(20),
	"preferred_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_memory" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" serial PRIMARY KEY NOT NULL,
	"openid" varchar(64),
	"unionid" varchar(64),
	"username" varchar(50),
	"password_hash" varchar(200),
	"nickname" varchar(50) DEFAULT '同学' NOT NULL,
	"avatar" varchar(500),
	"phone" varchar(20),
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_openid_unique" UNIQUE("openid"),
	CONSTRAINT "app_user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "after_sale" (
	"id" serial PRIMARY KEY NOT NULL,
	"after_sale_no" varchar(32) NOT NULL,
	"order_id" integer NOT NULL,
	"order_item_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(10) DEFAULT 'refund' NOT NULL,
	"reason" varchar(60) NOT NULL,
	"description" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"audit_remark" varchar(200),
	"audited_by" integer,
	"audited_at" timestamp with time zone,
	"source" varchar(10) DEFAULT 'miniapp' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "after_sale_after_sale_no_unique" UNIQUE("after_sale_no")
);
--> statement-breakpoint
CREATE TABLE "cart_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"sku_id" integer,
	"quantity" integer DEFAULT 1 NOT NULL,
	"selected" boolean DEFAULT true NOT NULL,
	"source" varchar(10) DEFAULT 'miniapp' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"sku_id" integer,
	"title_snapshot" varchar(120) NOT NULL,
	"cover_snapshot" varchar(500),
	"spec_snapshot" varchar(80),
	"price_cents" integer DEFAULT 0 NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"refund_status" varchar(20) DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_no" varchar(32) NOT NULL,
	"user_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending_pay' NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"freight_cents" integer DEFAULT 0 NOT NULL,
	"pay_cents" integer DEFAULT 0 NOT NULL,
	"pay_channel" varchar(20),
	"pay_status" varchar(20) DEFAULT 'unpaid' NOT NULL,
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"address_snapshot" jsonb,
	"remark" varchar(200),
	"source" varchar(10) DEFAULT 'miniapp' NOT NULL,
	"ai_conversation_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"channel" varchar(20) NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"trade_no" varchar(64),
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(20) NOT NULL,
	"amount_cents" integer NOT NULL,
	"balance_after" integer DEFAULT 0 NOT NULL,
	"ref_type" varchar(20),
	"ref_id" integer,
	"remark" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"username" varchar(50),
	"ip" varchar(60),
	"user_agent" varchar(300),
	"success" boolean DEFAULT true NOT NULL,
	"message" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(20) DEFAULT 'system' NOT NULL,
	"title" varchar(120) NOT NULL,
	"content" text,
	"read" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"actor" varchar(20) DEFAULT 'admin' NOT NULL,
	"module" varchar(40) NOT NULL,
	"action" varchar(40) NOT NULL,
	"target_id" varchar(60),
	"detail" jsonb,
	"ip" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sys_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(80) NOT NULL,
	"value" text,
	"remark" varchar(200),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sys_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sys_menu" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"name" varchar(40) NOT NULL,
	"path" varchar(120),
	"icon" varchar(60),
	"sort" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_conversation_id_ai_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sku" ADD CONSTRAINT "product_sku_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tag" ADD CONSTRAINT "product_tag_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tag" ADD CONSTRAINT "product_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_summary" ADD CONSTRAINT "review_summary_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "address" ADD CONSTRAINT "address_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_behavior" ADD CONSTRAINT "user_behavior_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "after_sale" ADD CONSTRAINT "after_sale_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "after_sale" ADD CONSTRAINT "after_sale_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_sku_id_product_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."product_sku"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_log" ADD CONSTRAINT "wallet_log_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_aiconv_user" ON "ai_conversation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_aiknow_scene" ON "ai_knowledge" USING btree ("scene");--> statement-breakpoint
CREATE INDEX "idx_aimsg_conv" ON "ai_message" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_aiact_user" ON "ai_pending_action" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_aiact_status" ON "ai_pending_action" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_aitool_conv" ON "ai_tool_call" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_aitool_name" ON "ai_tool_call" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "idx_category_kind" ON "category" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_pimage_product" ON "product_image" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_sku_product" ON "product_sku" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_product_kind" ON "product" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_product_category" ON "product" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_product_status" ON "product" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_review_product" ON "review" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_address_user" ON "address" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_behavior_user" ON "user_behavior" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_behavior_product" ON "user_behavior" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_user_role" ON "app_user" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_as_user" ON "after_sale" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_as_status" ON "after_sale" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_cart_user" ON "cart_item" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_oitem_order" ON "order_item" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_order_user" ON "order" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_order_status" ON "order" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_wallet_user" ON "wallet_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_loginlog_user" ON "login_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_notify_user" ON "notification" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_oplog_module" ON "operation_log" USING btree ("module");