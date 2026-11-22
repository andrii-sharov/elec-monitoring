CREATE TYPE "public"."device_state" AS ENUM('PENDING', 'ONLINE', 'OFFLINE', 'UPDATING');--> statement-breakpoint
CREATE TYPE "public"."diagnostic_kind" AS ENUM('WIFI', 'API');--> statement-breakpoint
CREATE TYPE "public"."outage_cause" AS ENUM('POWER', 'NETWORK', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."outage_kind" AS ENUM('SHORT', 'LONG');--> statement-breakpoint
CREATE TYPE "public"."outage_type" AS ENUM('OUTAGE', 'POWER_BLIP');--> statement-breakpoint
CREATE TYPE "public"."reset_reason" AS ENUM('POWER_ON', 'BROWNOUT', 'SOFTWARE', 'WATCHDOG', 'PANIC', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."update_outcome" AS ENUM('SUCCEEDED', 'FAILED', 'ROLLED_BACK');--> statement-breakpoint
CREATE TABLE "api_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"display_prefix" text NOT NULL,
	"scopes" text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_token_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "api_token_token_hash_check" CHECK (octet_length(token_hash) = 32),
	CONSTRAINT "api_token_scopes_check" CHECK (scopes in ('{read}', '{read,write}'))
);
--> statement-breakpoint
ALTER TABLE "api_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"google_sub" text,
	"name" text NOT NULL,
	"language" text DEFAULT 'uk' NOT NULL,
	"timezone" text DEFAULT 'Europe/Kyiv' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_key" UNIQUE("email"),
	CONSTRAINT "app_user_google_sub_key" UNIQUE("google_sub"),
	CONSTRAINT "app_user_email_check" CHECK (email = lower(email)),
	CONSTRAINT "app_user_language_check" CHECK (language in ('uk', 'en', 'ru')),
	CONSTRAINT "app_user_sign_in_method_check" CHECK (password_hash is not null or google_sub is not null)
);
--> statement-breakpoint
ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "one_time_token" (
	"token_hash" "bytea" PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_time_token_token_hash_check" CHECK (octet_length(token_hash) = 32),
	CONSTRAINT "one_time_token_purpose_check" CHECK (purpose in ('VERIFY_EMAIL', 'RESET_PASSWORD', 'TELEGRAM_LINK'))
);
--> statement-breakpoint
ALTER TABLE "one_time_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "refresh_token" (
	"token_hash" "bytea" PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_token_token_hash_check" CHECK (octet_length(token_hash) = 32)
);
--> statement-breakpoint
ALTER TABLE "refresh_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" "bytea",
	"pairing_code_hash" "bytea",
	"pairing_code_expires_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"state" "device_state" DEFAULT 'PENDING' NOT NULL,
	"state_since" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"offline_at" timestamp with time zone,
	"boot_id" uuid,
	"seq" integer,
	"uptime_s" integer,
	"rssi" smallint,
	"fw_version" text,
	"ping_interval_s" integer DEFAULT 30 NOT NULL,
	"previous_ping_interval_s" integer,
	"offline_timeout_s" integer DEFAULT 120 NOT NULL,
	"short_outage_threshold_s" integer DEFAULT 180 NOT NULL,
	"notify_short_outages" boolean DEFAULT true NOT NULL,
	"notify_network_outages" boolean DEFAULT true NOT NULL,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"auto_update" boolean DEFAULT false NOT NULL,
	"settings_version" integer DEFAULT 1 NOT NULL,
	"applied_settings_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "device_pairing_code_hash_key" UNIQUE("pairing_code_hash"),
	CONSTRAINT "device_name_check" CHECK (name <> ''),
	CONSTRAINT "device_token_hash_check" CHECK (octet_length(token_hash) = 32),
	CONSTRAINT "device_pairing_code_hash_check" CHECK (octet_length(pairing_code_hash) = 32),
	CONSTRAINT "device_ping_interval_check" CHECK (ping_interval_s >= 15),
	CONSTRAINT "device_offline_timeout_check" CHECK (offline_timeout_s >= 2 * ping_interval_s),
	CONSTRAINT "device_short_outage_threshold_check" CHECK (short_outage_threshold_s > 0),
	CONSTRAINT "device_quiet_hours_check" CHECK ((quiet_hours_start is null) = (quiet_hours_end is null)),
	CONSTRAINT "device_pairing_code_expiry_check" CHECK ((pairing_code_hash is null) = (pairing_code_expires_at is null)),
	CONSTRAINT "device_online_offline_at_check" CHECK ((state = 'ONLINE') = (offline_at is not null)),
	CONSTRAINT "device_applied_settings_version_check" CHECK (applied_settings_version <= settings_version)
);
--> statement-breakpoint
ALTER TABLE "device" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device_invite" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"email" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_invite_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "device_invite_email_check" CHECK (email = lower(email)),
	CONSTRAINT "device_invite_token_hash_check" CHECK (octet_length(token_hash) = 32)
);
--> statement-breakpoint
ALTER TABLE "device_invite" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device_viewer" (
	"device_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_viewer_device_id_user_id_pk" PRIMARY KEY("device_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "device_viewer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "firmware_release" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"version_code" integer NOT NULL,
	"channel" text DEFAULT 'STABLE' NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" "bytea" NOT NULL,
	"signature" "bytea" NOT NULL,
	"image_path" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "firmware_release_version_key" UNIQUE("version"),
	CONSTRAINT "firmware_release_version_code_key" UNIQUE("version_code"),
	CONSTRAINT "firmware_release_channel_check" CHECK (channel in ('STABLE', 'BETA')),
	CONSTRAINT "firmware_release_size_bytes_check" CHECK (size_bytes > 0),
	CONSTRAINT "firmware_release_sha256_check" CHECK (octet_length(sha256) = 32)
);
--> statement-breakpoint
ALTER TABLE "firmware_release" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "firmware_update_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"requested_by" uuid,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"start_boot_id" uuid,
	"started_at" timestamp with time zone,
	"window_ends_at" timestamp with time zone,
	"outcome" "update_outcome",
	"running_version" text,
	"result_boot_id" uuid,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "firmware_update_attempt_status_check" CHECK (status in ('QUEUED', 'INSTALLING', 'FINISHED', 'TIMED_OUT', 'CANCELLED')),
	CONSTRAINT "firmware_update_attempt_started_check" CHECK (status in ('QUEUED', 'CANCELLED') or (started_at is not null and window_ends_at is not null)),
	CONSTRAINT "firmware_update_attempt_outcome_check" CHECK ((outcome is null) = (finished_at is null)),
	CONSTRAINT "firmware_update_attempt_finished_check" CHECK (status <> 'FINISHED' or outcome is not null)
);
--> statement-breakpoint
ALTER TABLE "firmware_update_attempt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device_boot" (
	"device_id" uuid NOT NULL,
	"boot_id" uuid NOT NULL,
	"reset_reason" "reset_reason" NOT NULL,
	"wifi_evicted" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_boot_device_id_boot_id_pk" PRIMARY KEY("device_id","boot_id")
);
--> statement-breakpoint
ALTER TABLE "device_boot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device_diagnostic" (
	"device_id" uuid NOT NULL,
	"boot_id" uuid NOT NULL,
	"local_id" integer NOT NULL,
	"kind" "diagnostic_kind" NOT NULL,
	"reason" smallint,
	"start_uptime_s" integer NOT NULL,
	"end_uptime_s" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_diagnostic_device_id_boot_id_local_id_pk" PRIMARY KEY("device_id","boot_id","local_id"),
	CONSTRAINT "device_diagnostic_uptime_check" CHECK (end_uptime_s >= start_uptime_s)
);
--> statement-breakpoint
ALTER TABLE "device_diagnostic" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"type" "outage_type" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_s" integer GENERATED ALWAYS AS (extract(epoch from ended_at - started_at)::integer) STORED,
	"cause" "outage_cause",
	"kind" "outage_kind",
	"ota_attempt_id" uuid,
	"off_alert_due_at" timestamp with time zone,
	"off_alert_queued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outage_ended_check" CHECK (ended_at is null or ended_at >= started_at),
	CONSTRAINT "outage_closed_fields_check" CHECK ((ended_at is null) = (cause is null) and (ended_at is null) = (kind is null)),
	CONSTRAINT "outage_power_blip_check" CHECK (type = 'OUTAGE' or (ended_at is not null and off_alert_due_at is null))
);
--> statement-breakpoint
ALTER TABLE "outage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "delivery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outage_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_event_check" CHECK (event in ('device.offline', 'device.online', 'device.power_blip')),
	CONSTRAINT "delivery_status_check" CHECK (status in ('QUEUED', 'SENT', 'RETRYING', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device_channel" (
	"device_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_channel_device_id_channel_id_pk" PRIMARY KEY("device_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "device_channel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_channel" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"telegram_chat_id" bigint,
	"telegram_bot_token_enc" "bytea",
	"webhook_url" text,
	"webhook_events" text[],
	"webhook_secret_enc" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_channel_type_check" CHECK (type in ('TELEGRAM_PLATFORM', 'TELEGRAM_BOT', 'WEBHOOK')),
	CONSTRAINT "notification_channel_disabled_reason_check" CHECK (disabled_reason in ('USER', 'TOO_MANY_FAILURES')),
	CONSTRAINT "notification_channel_enabled_check" CHECK (enabled = (disabled_reason is null)),
	CONSTRAINT "notification_channel_type_columns_check" CHECK ((type = 'TELEGRAM_PLATFORM'
          and telegram_chat_id is not null
          and num_nonnulls(telegram_bot_token_enc, webhook_url, webhook_events, webhook_secret_enc) = 0)
        or (type = 'TELEGRAM_BOT'
          and num_nonnulls(telegram_chat_id, telegram_bot_token_enc) = 2
          and num_nonnulls(webhook_url, webhook_events, webhook_secret_enc) = 0)
        or (type = 'WEBHOOK'
          and num_nonnulls(webhook_url, webhook_events, webhook_secret_enc) = 3
          and num_nonnulls(telegram_chat_id, telegram_bot_token_enc) = 0)),
	CONSTRAINT "notification_channel_webhook_events_check" CHECK (cardinality(webhook_events) > 0
        and webhook_events <@ array['device.offline', 'device.online', 'device.power_blip'])
);
--> statement-breakpoint
ALTER TABLE "notification_channel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "worker_heartbeat" (
	"worker" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"beat_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "worker_heartbeat" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_token" ADD CONSTRAINT "one_time_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_invite" ADD CONSTRAINT "device_invite_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_invite" ADD CONSTRAINT "device_invite_invited_by_app_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_viewer" ADD CONSTRAINT "device_viewer_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_viewer" ADD CONSTRAINT "device_viewer_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmware_update_attempt" ADD CONSTRAINT "firmware_update_attempt_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmware_update_attempt" ADD CONSTRAINT "firmware_update_attempt_release_id_firmware_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."firmware_release"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmware_update_attempt" ADD CONSTRAINT "firmware_update_attempt_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_boot" ADD CONSTRAINT "device_boot_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_diagnostic" ADD CONSTRAINT "device_diagnostic_boot_fkey" FOREIGN KEY ("device_id","boot_id") REFERENCES "public"."device_boot"("device_id","boot_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outage" ADD CONSTRAINT "outage_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outage" ADD CONSTRAINT "outage_ota_attempt_id_firmware_update_attempt_id_fk" FOREIGN KEY ("ota_attempt_id") REFERENCES "public"."firmware_update_attempt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_outage_id_outage_id_fk" FOREIGN KEY ("outage_id") REFERENCES "public"."outage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_channel_id_notification_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_channel" ADD CONSTRAINT "device_channel_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_channel" ADD CONSTRAINT "device_channel_channel_id_notification_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_token_user_id_idx" ON "api_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "one_time_token_user_id_idx" ON "one_time_token" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "refresh_token_session_id_idx" ON "refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "device_owner_id_idx" ON "device" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "device_offline_at_idx" ON "device" USING btree ("offline_at") WHERE state = 'ONLINE';--> statement-breakpoint
CREATE UNIQUE INDEX "device_invite_pending_key" ON "device_invite" USING btree ("device_id","email") WHERE accepted_at is null;--> statement-breakpoint
CREATE INDEX "device_invite_invited_by_idx" ON "device_invite" USING btree ("invited_by");--> statement-breakpoint
CREATE INDEX "device_viewer_user_id_idx" ON "device_viewer" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "firmware_update_attempt_device_idx" ON "firmware_update_attempt" USING btree ("device_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_update_attempt_one_active" ON "firmware_update_attempt" USING btree ("device_id") WHERE status in ('QUEUED', 'INSTALLING');--> statement-breakpoint
CREATE INDEX "firmware_update_attempt_window_idx" ON "firmware_update_attempt" USING btree ("window_ends_at") WHERE status = 'INSTALLING';--> statement-breakpoint
CREATE INDEX "firmware_update_attempt_release_id_idx" ON "firmware_update_attempt" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "firmware_update_attempt_requested_by_idx" ON "firmware_update_attempt" USING btree ("requested_by") WHERE requested_by is not null;--> statement-breakpoint
CREATE INDEX "device_diagnostic_device_started_idx" ON "device_diagnostic" USING btree ("device_id","started_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "outage_device_started_idx" ON "outage" USING btree ("device_id","started_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "outage_one_open_per_device" ON "outage" USING btree ("device_id") WHERE ended_at is null;--> statement-breakpoint
CREATE INDEX "outage_off_alert_due_idx" ON "outage" USING btree ("off_alert_due_at") WHERE ended_at is null and off_alert_queued_at is null;--> statement-breakpoint
CREATE INDEX "outage_ota_attempt_id_idx" ON "outage" USING btree ("ota_attempt_id") WHERE ota_attempt_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_once_per_event" ON "delivery" USING btree ("outage_id","channel_id","event");--> statement-breakpoint
CREATE INDEX "delivery_channel_created_idx" ON "delivery" USING btree ("channel_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "delivery_due_idx" ON "delivery" USING btree ("next_attempt_at") WHERE status in ('QUEUED', 'RETRYING');--> statement-breakpoint
CREATE INDEX "device_channel_channel_id_idx" ON "device_channel" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "notification_channel_user_id_idx" ON "notification_channel" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_channel_platform_chat_key" ON "notification_channel" USING btree ("user_id","telegram_chat_id") WHERE type = 'TELEGRAM_PLATFORM';--> statement-breakpoint
CREATE INDEX "notification_channel_platform_chat_idx" ON "notification_channel" USING btree ("telegram_chat_id") WHERE type = 'TELEGRAM_PLATFORM';