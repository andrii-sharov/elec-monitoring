ALTER TABLE "one_time_token" DROP CONSTRAINT "one_time_token_purpose_check";--> statement-breakpoint
ALTER TABLE "app_user" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_invite" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "telegram_user_id" bigint;--> statement-breakpoint
ALTER TABLE "one_time_token" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "one_time_token" ADD COLUMN "telegram_user_id" bigint;--> statement-breakpoint
ALTER TABLE "device_invite" ADD COLUMN "phone" text;--> statement-breakpoint
CREATE INDEX "one_time_token_telegram_user_idx" ON "one_time_token" USING btree ("telegram_user_id") WHERE used_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "device_invite_pending_phone_key" ON "device_invite" USING btree ("device_id","phone") WHERE accepted_at is null;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_phone_key" UNIQUE("phone");--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_telegram_user_id_key" UNIQUE("telegram_user_id");--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_identifier_check" CHECK (email is not null or phone is not null);--> statement-breakpoint
ALTER TABLE "one_time_token" ADD CONSTRAINT "one_time_token_purpose_check" CHECK (purpose in ('VERIFY_EMAIL', 'RESET_PASSWORD', 'TELEGRAM_LINK', 'PHONE_VERIFY', 'PHONE_RECOVER')) NOT VALID;--> statement-breakpoint
ALTER TABLE "one_time_token" VALIDATE CONSTRAINT "one_time_token_purpose_check";--> statement-breakpoint
ALTER TABLE "device_invite" ADD CONSTRAINT "device_invite_one_identifier_check" CHECK (num_nonnulls(email, phone) = 1);