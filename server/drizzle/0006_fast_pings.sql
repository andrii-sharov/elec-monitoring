ALTER TABLE "device" DROP CONSTRAINT "device_ping_interval_check";--> statement-breakpoint
ALTER TABLE "device" ALTER COLUMN "ping_interval_s" SET DEFAULT 20;--> statement-breakpoint
ALTER TABLE "device" ALTER COLUMN "offline_timeout_s" SET DEFAULT 40;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_ping_interval_check" CHECK (ping_interval_s >= 5);