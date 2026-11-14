ALTER TABLE `appliances` MODIFY COLUMN `category` varchar(40) NOT NULL DEFAULT 'other';--> statement-breakpoint
ALTER TABLE `appliances` ADD `brand` varchar(120) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `appliances` ADD `model` varchar(120) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `appliances` ADD `installation_date` timestamp(3);--> statement-breakpoint
ALTER TABLE `appliances` ADD `last_service_date` timestamp(3);--> statement-breakpoint
ALTER TABLE `appliances` ADD `recommended_service_interval_days` int DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `appliances` ADD `maintenance_notes` text;