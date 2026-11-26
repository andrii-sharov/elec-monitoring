DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "notification_channel" WHERE "type" = 'TELEGRAM_BOT') THEN
    RAISE EXCEPTION 'notification_channel has TELEGRAM_BOT rows; remove them before this migration';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "notification_channel" DROP CONSTRAINT "notification_channel_type_check";--> statement-breakpoint
ALTER TABLE "notification_channel" DROP CONSTRAINT "notification_channel_type_columns_check";--> statement-breakpoint
ALTER TABLE "notification_channel" DROP COLUMN "telegram_bot_token_enc";--> statement-breakpoint
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_type_check" CHECK (type in ('TELEGRAM_PLATFORM', 'WEBHOOK'));--> statement-breakpoint
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_type_columns_check" CHECK ((type = 'TELEGRAM_PLATFORM'
          and telegram_chat_id is not null
          and num_nonnulls(webhook_url, webhook_events, webhook_secret_enc) = 0)
        or (type = 'WEBHOOK'
          and num_nonnulls(webhook_url, webhook_events, webhook_secret_enc) = 3
          and telegram_chat_id is null));