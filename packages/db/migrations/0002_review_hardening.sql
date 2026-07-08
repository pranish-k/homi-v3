-- idempotency_keys is a replay cache, not ledger data: safe to truncate
-- pre-production so the NOT NULL request_hash column applies cleanly.
TRUNCATE TABLE "idempotency_keys";--> statement-breakpoint
ALTER TABLE "idempotency_keys" DROP CONSTRAINT "idempotency_keys_pkey";--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_key_user_id_endpoint_pk" PRIMARY KEY("key","user_id","endpoint");--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "request_hash" text NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_user" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_auth_verifications_identifier" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_house_members_user" ON "house_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_invites_house" ON "invites" USING btree ("house_id");--> statement-breakpoint
CREATE INDEX "idx_rooms_house" ON "rooms" USING btree ("house_id");--> statement-breakpoint
CREATE INDEX "idx_activity_events_house_created" ON "activity_events" USING btree ("house_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_expense_splits_user" ON "expense_splits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_expenses_house" ON "expenses" USING btree ("house_id");--> statement-breakpoint
CREATE INDEX "idx_payments_house" ON "payments" USING btree ("house_id");--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "chk_invites_uses_within_max" CHECK ("invites"."uses" <= "invites"."max_uses");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "chk_rooms_weight_range" CHECK ("rooms"."weight_bp" BETWEEN 1 AND 10000);--> statement-breakpoint
ALTER TABLE "expense_splits" ADD CONSTRAINT "chk_expense_splits_amount_nonnegative" CHECK ("expense_splits"."amount_cents" >= 0);--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "chk_expenses_amount_positive" CHECK ("expenses"."amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_amount_positive" CHECK ("payments"."amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_distinct_parties" CHECK ("payments"."from_user" <> "payments"."to_user");