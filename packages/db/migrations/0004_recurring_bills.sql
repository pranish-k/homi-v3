-- HOMI-13 expand-only migration. NOT NULL created_by without a default is
-- safe: bill_templates has never had a write path, so the table is empty in
-- every environment. uq_expenses_template_period is the H4 guarantee: a
-- re-run posting job trips the index instead of double-posting rent.
ALTER TABLE "bill_templates" ADD COLUMN "created_by" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_templates" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "period" text;--> statement-breakpoint
ALTER TABLE "bill_templates" ADD CONSTRAINT "bill_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bill_templates_due" ON "bill_templates" USING btree ("next_run") WHERE "bill_templates"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_expenses_template_period" ON "expenses" USING btree ("template_id","period") WHERE "expenses"."template_id" is not null;--> statement-breakpoint
ALTER TABLE "bill_templates" ADD CONSTRAINT "chk_bill_templates_amount_positive" CHECK ("bill_templates"."amount_cents" > 0);
