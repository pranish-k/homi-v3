DROP INDEX "idx_expenses_house";--> statement-breakpoint
DROP INDEX "idx_payments_house";--> statement-breakpoint
ALTER TABLE "activity_events" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
CREATE INDEX "idx_expenses_house_created" ON "expenses" USING btree ("house_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_payments_house_created" ON "payments" USING btree ("house_id","created_at","id");