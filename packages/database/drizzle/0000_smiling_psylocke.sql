CREATE TABLE `email_verifications` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`code_hash` char(64) NOT NULL,
	`purpose` enum('email_verify','login_otp') NOT NULL DEFAULT 'email_verify',
	`attempts` int NOT NULL DEFAULT 0,
	`expires_at` timestamp(3) NOT NULL,
	`consumed_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `email_verifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`used_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `password_resets_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_password_resets_token` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`user_agent` varchar(512),
	`ip_address` varchar(64),
	`remember_me` boolean NOT NULL DEFAULT false,
	`expires_at` timestamp(3) NOT NULL,
	`last_used_at` timestamp(3) NOT NULL DEFAULT (now()),
	`revoked_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `user_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sessions_token` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`name` varchar(120) NOT NULL,
	`role` enum('user','admin','super_admin','support_agent') NOT NULL DEFAULT 'user',
	`email_verified_at` timestamp(3),
	`avatar_url` varchar(512),
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
	`currency` char(3) NOT NULL DEFAULT 'INR',
	`is_suspended` boolean NOT NULL DEFAULT false,
	`last_login_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_email` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `appliance_usage` (
	`id` char(36) NOT NULL,
	`appliance_id` char(36) NOT NULL,
	`period_start` timestamp(3) NOT NULL,
	`period_end` timestamp(3) NOT NULL,
	`estimated_kwh` double NOT NULL DEFAULT 0,
	`allocated_kwh` double,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `appliance_usage_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `appliances` (
	`id` char(36) NOT NULL,
	`home_id` char(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`category` varchar(40) NOT NULL,
	`rated_power_w` double NOT NULL DEFAULT 0,
	`estimated_hours_per_day` double NOT NULL DEFAULT 0,
	`is_measured` boolean NOT NULL DEFAULT false,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp(3),
	CONSTRAINT `appliances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `device_credentials` (
	`id` char(36) NOT NULL,
	`device_id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`label` varchar(80) NOT NULL DEFAULT 'Primary credential',
	`last_used_at` timestamp(3),
	`expires_at` timestamp(3),
	`revoked_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `device_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_device_credentials_token` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `device_pairings` (
	`id` char(36) NOT NULL,
	`code` varchar(32) NOT NULL,
	`claimed_by` char(36),
	`device_id` char(36),
	`expires_at` timestamp(3) NOT NULL,
	`claimed_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `device_pairings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_pairings_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `device_telemetry` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`device_id` char(36) NOT NULL,
	`recorded_at` timestamp(3) NOT NULL,
	`voltage` double,
	`current` double,
	`active_power` double,
	`apparent_power` double,
	`power_factor` double,
	`energy_kwh` double,
	`temperature` double,
	`frequency` double,
	`signal_strength` smallint,
	`source` enum('hardware','simulated') NOT NULL DEFAULT 'hardware',
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `device_telemetry_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` char(36) NOT NULL,
	`home_id` char(36) NOT NULL,
	`owner_id` char(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`serial` varchar(64) NOT NULL,
	`model` varchar(64) NOT NULL DEFAULT 'WattNexa CT-1',
	`room` varchar(80),
	`firmware_version` varchar(40),
	`status` enum('online','offline','pairing','error') NOT NULL DEFAULT 'pairing',
	`last_seen_at` timestamp(3),
	`last_reading_at` timestamp(3),
	`signal_strength` smallint,
	`pairing_code` varchar(32),
	`pairing_expires_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp(3),
	CONSTRAINT `devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_devices_serial` UNIQUE(`serial`),
	CONSTRAINT `uq_devices_pairing_code` UNIQUE(`pairing_code`)
);
--> statement-breakpoint
CREATE TABLE `electricity_bills` (
	`id` char(36) NOT NULL,
	`home_id` char(36) NOT NULL,
	`tariff_id` char(36),
	`period_start` timestamp(3) NOT NULL,
	`period_end` timestamp(3) NOT NULL,
	`energy_kwh` double NOT NULL DEFAULT 0,
	`estimated_cost` double NOT NULL DEFAULT 0,
	`actual_cost` double,
	`currency` char(3) NOT NULL DEFAULT 'INR',
	`status` enum('estimated','actual') NOT NULL DEFAULT 'estimated',
	`breakdown` json,
	`notes` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `electricity_bills_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `energy_aggregates` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`home_id` char(36) NOT NULL,
	`device_id` char(36) NOT NULL,
	`bucket` enum('hour','day','month') NOT NULL,
	`bucket_start` timestamp(3) NOT NULL,
	`energy_kwh` double NOT NULL DEFAULT 0,
	`peak_power_w` double NOT NULL DEFAULT 0,
	`average_power_w` double NOT NULL DEFAULT 0,
	`sample_count` int NOT NULL DEFAULT 0,
	`source` enum('hardware','simulated') NOT NULL DEFAULT 'hardware',
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `energy_aggregates_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_aggregates_device_bucket` UNIQUE(`device_id`,`bucket`,`bucket_start`)
);
--> statement-breakpoint
CREATE TABLE `homes` (
	`id` char(36) NOT NULL,
	`owner_id` char(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`type` enum('home','apartment','office','shop','other') NOT NULL DEFAULT 'home',
	`address` varchar(240),
	`city` varchar(80),
	`region` varchar(80),
	`country` varchar(80) NOT NULL DEFAULT 'India',
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp(3),
	CONSTRAINT `homes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `household_members` (
	`id` char(36) NOT NULL,
	`home_id` char(36) NOT NULL,
	`user_id` char(36),
	`invited_email` varchar(255),
	`role` enum('owner','admin','viewer') NOT NULL DEFAULT 'viewer',
	`status` enum('active','invited','revoked') NOT NULL DEFAULT 'active',
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `household_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_members_home_user` UNIQUE(`home_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `tariff_slabs` (
	`id` char(36) NOT NULL,
	`tariff_id` char(36) NOT NULL,
	`min_kwh` double NOT NULL DEFAULT 0,
	`max_kwh` double,
	`rate_per_kwh` double NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `tariff_slabs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tariffs` (
	`id` char(36) NOT NULL,
	`home_id` char(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`provider` varchar(120),
	`region` varchar(120),
	`currency` char(3) NOT NULL DEFAULT 'INR',
	`fixed_charge` double NOT NULL DEFAULT 0,
	`tax_percent` double NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tariffs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`home_id` char(36),
	`device_id` char(36),
	`type` enum('high_power','unusual_consumption','device_offline','device_online','high_temperature','daily_threshold','monthly_threshold','bill_threshold','device_error','firmware_update','account') NOT NULL,
	`severity` enum('info','warning','critical') NOT NULL DEFAULT 'warning',
	`title` varchar(160) NOT NULL,
	`message` text NOT NULL,
	`metadata` json,
	`acknowledged_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` char(36) NOT NULL,
	`title` varchar(160) NOT NULL,
	`body` text NOT NULL,
	`level` enum('info','warning','critical') NOT NULL DEFAULT 'info',
	`is_active` boolean NOT NULL DEFAULT true,
	`published_at` timestamp(3) NOT NULL DEFAULT (now()),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `announcements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` char(36) NOT NULL,
	`actor_id` char(36),
	`action` varchar(80) NOT NULL,
	`resource_type` varchar(60) NOT NULL,
	`resource_id` varchar(64),
	`metadata` json,
	`ip_address` varchar(64),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automation_executions` (
	`id` char(36) NOT NULL,
	`rule_id` char(36) NOT NULL,
	`status` enum('success','skipped','failed') NOT NULL DEFAULT 'success',
	`detail` varchar(320),
	`executed_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `automation_executions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automation_rules` (
	`id` char(36) NOT NULL,
	`home_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`trigger_type` enum('power_above','temperature_above','device_offline','daily_summary','monthly_usage_above') NOT NULL,
	`threshold` double,
	`action_type` enum('notify','email','summary') NOT NULL DEFAULT 'notify',
	`message` varchar(240),
	`is_active` boolean NOT NULL DEFAULT true,
	`last_run_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `automation_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `blog_posts` (
	`id` char(36) NOT NULL,
	`slug` varchar(160) NOT NULL,
	`title` varchar(200) NOT NULL,
	`excerpt` varchar(400) NOT NULL,
	`content` text NOT NULL,
	`cover_image` varchar(512),
	`author_id` char(36),
	`status` enum('draft','published') NOT NULL DEFAULT 'draft',
	`published_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp(3),
	CONSTRAINT `blog_posts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_blog_slug` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `faqs` (
	`id` char(36) NOT NULL,
	`question` varchar(240) NOT NULL,
	`answer` text NOT NULL,
	`category` varchar(60) NOT NULL DEFAULT 'general',
	`is_published` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `faqs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`subscription_id` char(36),
	`number` varchar(40) NOT NULL,
	`amount` double NOT NULL DEFAULT 0,
	`currency` char(3) NOT NULL DEFAULT 'INR',
	`status` enum('draft','open','paid','void') NOT NULL DEFAULT 'open',
	`issued_at` timestamp(3) NOT NULL DEFAULT (now()),
	`paid_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_invoices_number` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` char(36) NOT NULL,
	`email_enabled` boolean NOT NULL DEFAULT true,
	`push_enabled` boolean NOT NULL DEFAULT false,
	`power_threshold_w` double,
	`temperature_threshold_c` double,
	`daily_kwh_threshold` double,
	`monthly_kwh_threshold` double,
	`bill_threshold` double,
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_preferences_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`alert_id` char(36),
	`channel` enum('in_app','email','push') NOT NULL DEFAULT 'in_app',
	`title` varchar(160) NOT NULL,
	`body` text NOT NULL,
	`read_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` char(36) NOT NULL,
	`invoice_id` char(36) NOT NULL,
	`provider` varchar(40) NOT NULL DEFAULT 'sandbox',
	`provider_ref` varchar(120),
	`amount` double NOT NULL,
	`currency` char(3) NOT NULL DEFAULT 'INR',
	`status` enum('pending','succeeded','failed','refunded','simulated') NOT NULL DEFAULT 'pending',
	`method` varchar(40),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscription_plans` (
	`id` char(36) NOT NULL,
	`slug` varchar(40) NOT NULL,
	`name` varchar(80) NOT NULL,
	`description` varchar(240),
	`price_monthly` double NOT NULL DEFAULT 0,
	`currency` char(3) NOT NULL DEFAULT 'INR',
	`max_homes` int NOT NULL DEFAULT 1,
	`max_devices` int NOT NULL DEFAULT 1,
	`history_days` int NOT NULL DEFAULT 7,
	`wattbot_messages_per_day` int NOT NULL DEFAULT 0,
	`features` json,
	`is_active` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscription_plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_plans_slug` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`plan_id` char(36) NOT NULL,
	`status` enum('active','trialing','past_due','canceled') NOT NULL DEFAULT 'active',
	`current_period_start` timestamp(3) NOT NULL,
	`current_period_end` timestamp(3) NOT NULL,
	`cancel_at_period_end` boolean NOT NULL DEFAULT false,
	`provider` varchar(40) NOT NULL DEFAULT 'sandbox',
	`provider_ref` varchar(120),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `support_messages` (
	`id` char(36) NOT NULL,
	`ticket_id` char(36) NOT NULL,
	`author_id` char(36),
	`body` text NOT NULL,
	`attachment_url` varchar(512),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `support_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`subject` varchar(160) NOT NULL,
	`category` enum('billing','device','account','technical','other') NOT NULL DEFAULT 'other',
	`priority` enum('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
	`status` enum('open','pending','resolved','closed') NOT NULL DEFAULT 'open',
	`assigned_to` char(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `support_tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` varchar(80) NOT NULL,
	`value` json NOT NULL,
	`description` varchar(240),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `system_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `wattbot_conversations` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`title` varchar(160) NOT NULL DEFAULT 'New conversation',
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wattbot_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wattbot_messages` (
	`id` char(36) NOT NULL,
	`conversation_id` char(36) NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`provider` varchar(40) NOT NULL DEFAULT 'rule_based',
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `wattbot_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `email_verifications` ADD CONSTRAINT `email_verifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `password_resets` ADD CONSTRAINT `password_resets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_sessions` ADD CONSTRAINT `user_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appliance_usage` ADD CONSTRAINT `appliance_usage_appliance_id_appliances_id_fk` FOREIGN KEY (`appliance_id`) REFERENCES `appliances`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appliances` ADD CONSTRAINT `appliances_home_id_homes_id_fk` FOREIGN KEY (`home_id`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `device_credentials` ADD CONSTRAINT `device_credentials_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `device_pairings` ADD CONSTRAINT `device_pairings_claimed_by_users_id_fk` FOREIGN KEY (`claimed_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `device_pairings` ADD CONSTRAINT `device_pairings_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `device_telemetry` ADD CONSTRAINT `device_telemetry_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `devices` ADD CONSTRAINT `devices_home_id_homes_id_fk` FOREIGN KEY (`home_id`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `devices` ADD CONSTRAINT `devices_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `electricity_bills` ADD CONSTRAINT `electricity_bills_home_id_homes_id_fk` FOREIGN KEY (`home_id`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `electricity_bills` ADD CONSTRAINT `electricity_bills_tariff_id_tariffs_id_fk` FOREIGN KEY (`tariff_id`) REFERENCES `tariffs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `energy_aggregates` ADD CONSTRAINT `energy_aggregates_home_id_homes_id_fk` FOREIGN KEY (`home_id`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `energy_aggregates` ADD CONSTRAINT `energy_aggregates_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `homes` ADD CONSTRAINT `homes_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `household_members` ADD CONSTRAINT `household_members_home_id_homes_id_fk` FOREIGN KEY (`home_id`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `household_members` ADD CONSTRAINT `household_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tariff_slabs` ADD CONSTRAINT `tariff_slabs_tariff_id_tariffs_id_fk` FOREIGN KEY (`tariff_id`) REFERENCES `tariffs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tariffs` ADD CONSTRAINT `tariffs_home_id_homes_id_fk` FOREIGN KEY (`home_id`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_home_id_homes_id_fk` FOREIGN KEY (`home_id`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automation_executions` ADD CONSTRAINT `automation_executions_rule_id_automation_rules_id_fk` FOREIGN KEY (`rule_id`) REFERENCES `automation_rules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automation_rules` ADD CONSTRAINT `automation_rules_home_id_homes_id_fk` FOREIGN KEY (`home_id`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automation_rules` ADD CONSTRAINT `automation_rules_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_posts` ADD CONSTRAINT `blog_posts_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_subscription_id_subscriptions_id_fk` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_alert_id_alerts_id_fk` FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_plan_id_subscription_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `support_messages` ADD CONSTRAINT `support_messages_ticket_id_support_tickets_id_fk` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `support_messages` ADD CONSTRAINT `support_messages_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_assigned_to_users_id_fk` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wattbot_conversations` ADD CONSTRAINT `wattbot_conversations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wattbot_messages` ADD CONSTRAINT `wattbot_messages_conversation_id_wattbot_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `wattbot_conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_verifications_user` ON `email_verifications` (`user_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `idx_password_resets_user` ON `password_resets` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `user_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_users_role` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `idx_users_created_at` ON `users` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_appliance_usage_period` ON `appliance_usage` (`appliance_id`,`period_start`);--> statement-breakpoint
CREATE INDEX `idx_appliances_home` ON `appliances` (`home_id`);--> statement-breakpoint
CREATE INDEX `idx_device_credentials_device` ON `device_credentials` (`device_id`);--> statement-breakpoint
CREATE INDEX `idx_telemetry_device_time` ON `device_telemetry` (`device_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_telemetry_recorded` ON `device_telemetry` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_devices_home` ON `devices` (`home_id`);--> statement-breakpoint
CREATE INDEX `idx_devices_owner` ON `devices` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_devices_status` ON `devices` (`status`);--> statement-breakpoint
CREATE INDEX `idx_bills_home_period` ON `electricity_bills` (`home_id`,`period_start`);--> statement-breakpoint
CREATE INDEX `idx_aggregates_home_bucket` ON `energy_aggregates` (`home_id`,`bucket`,`bucket_start`);--> statement-breakpoint
CREATE INDEX `idx_homes_owner` ON `homes` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_members_user` ON `household_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_tariff_slabs_tariff` ON `tariff_slabs` (`tariff_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_tariffs_home` ON `tariffs` (`home_id`);--> statement-breakpoint
CREATE INDEX `idx_alerts_user_created` ON `alerts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_alerts_home_created` ON `alerts` (`home_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_executions_rule` ON `automation_executions` (`rule_id`,`executed_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_home` ON `automation_rules` (`home_id`);--> statement-breakpoint
CREATE INDEX `idx_invoices_user` ON `invoices` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_notifications_user_created` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payments_invoice` ON `payments` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_user` ON `subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_support_messages_ticket` ON `support_messages` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_tickets_user` ON `support_tickets` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_conversations_user` ON `wattbot_conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_messages_conversation` ON `wattbot_messages` (`conversation_id`,`created_at`);