ALTER TABLE "one_time_token" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "one_time_token" ADD CONSTRAINT "one_time_token_email_check" CHECK (email = lower(email));--> statement-breakpoint
UPDATE "one_time_token" SET "used_at" = now() WHERE "purpose" = 'VERIFY_EMAIL' AND "used_at" IS NULL AND "user_id" IN (SELECT "id" FROM "app_user" WHERE "phone" IS NOT NULL AND "email" IS NOT NULL AND "email_verified_at" IS NULL);--> statement-breakpoint
UPDATE "app_user" SET "email" = NULL WHERE "phone" IS NOT NULL AND "email" IS NOT NULL AND "email_verified_at" IS NULL;--> statement-breakpoint
UPDATE "app_user" SET "google_sub" = NULL WHERE "google_sub" IS NOT NULL AND "email_verified_at" IS NULL AND "phone_verified_at" IS NULL;
