CREATE TABLE `device_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`device_id` char(36) NOT NULL,
	`type` enum('paired','connected','reconnected','disconnected','error','credential_issued','credential_revoked','telemetry_rejected','status_changed') NOT NULL,
	`message` varchar(240),
	`metadata` json,
	`occurred_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `device_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- Existing devices waiting for their first reading move to the new explicit state.
UPDATE `devices` SET `status` = 'not_configured' WHERE `status` = 'pairing';--> statement-breakpoint
ALTER TABLE `devices` MODIFY COLUMN `status` enum('online','offline','connecting','not_configured','error') NOT NULL DEFAULT 'not_configured';--> statement-breakpoint
ALTER TABLE `device_telemetry` ADD `message_id` varchar(64);--> statement-breakpoint
ALTER TABLE `device_telemetry` ADD CONSTRAINT `uq_telemetry_device_message` UNIQUE(`device_id`,`message_id`);--> statement-breakpoint
ALTER TABLE `device_events` ADD CONSTRAINT `device_events_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_device_events_device_time` ON `device_events` (`device_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_device_events_type` ON `device_events` (`type`);