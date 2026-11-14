CREATE TABLE `bill_corrections` (
	`id` char(36) NOT NULL,
	`bill_id` char(36) NOT NULL,
	`household_id` char(36) NOT NULL,
	`edited_by` char(36),
	`previous_amount` double,
	`new_amount` double,
	`previous_units` double,
	`new_units` double,
	`reason` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `bill_corrections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `electricity_bills` ADD `fixed_charge` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `electricity_bills` ADD `duty` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `electricity_bills` ADD `rebate` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `electricity_bills` ADD `distributor` varchar(120);--> statement-breakpoint
ALTER TABLE `tariffs` ADD `distributor` varchar(120);--> statement-breakpoint
ALTER TABLE `tariffs` ADD `duty_rate` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tariffs` ADD `effective_from` timestamp(3) DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `tariffs` ADD `effective_to` timestamp(3);--> statement-breakpoint
ALTER TABLE `tariffs` ADD `source_reference` varchar(255);--> statement-breakpoint
ALTER TABLE `bill_corrections` ADD CONSTRAINT `bill_corrections_bill_id_electricity_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `electricity_bills`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_corrections` ADD CONSTRAINT `bill_corrections_household_id_homes_id_fk` FOREIGN KEY (`household_id`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_corrections` ADD CONSTRAINT `bill_corrections_edited_by_users_id_fk` FOREIGN KEY (`edited_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_bill_corrections_bill` ON `bill_corrections` (`bill_id`);