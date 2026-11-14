-- 0004_appliance_health.sql — Appliance Health Intelligence module

-- Extend appliances table with additional fields for monitoring
ALTER TABLE `appliances`
  ADD COLUMN `category` enum('air_conditioner','refrigerator','washing_machine','water_heater','fan','television','computer','water_pump','kitchen_appliance','other') NOT NULL DEFAULT 'other' AFTER `name`,
  ADD COLUMN `brand` varchar(120) NOT NULL DEFAULT '' AFTER `category`,
  ADD COLUMN `model` varchar(120) NOT NULL DEFAULT '' AFTER `brand`,
  ADD COLUMN `installationDate` timestamp(3) NULL DEFAULT NULL AFTER `model`,
  ADD COLUMN `ratedPowerW` double NOT NULL DEFAULT 0 AFTER `installationDate`,
  ADD COLUMN `estimatedHoursPerDay` double NOT NULL DEFAULT 0 AFTER `ratedPowerW`,
  ADD COLUMN `isMeasured` boolean NOT NULL DEFAULT false AFTER `estimatedHoursPerDay`,
  ADD COLUMN `lastServiceDate` timestamp(3) NULL DEFAULT NULL AFTER `isMeasured`,
  ADD COLUMN `recommendedServiceIntervalDays` int NOT NULL DEFAULT 30 AFTER `lastServiceDate`,
  ADD COLUMN `maintenanceNotes` text NULL DEFAULT NULL AFTER `recommendedServiceIntervalDays`;

-- Create appliance_monitor_assignments table
CREATE TABLE `appliance_monitor_assignments` (
  `id` char(36) NOT NULL,
  `applianceId` char(36) NOT NULL,
  `homeId` char(36) NOT NULL,
  `monitoringMethod` enum('smart_plug','sub_meter','whole_house_ct') NOT NULL DEFAULT 'whole_house_ct',
  `connectedDeviceId` char(36) NULL DEFAULT NULL,
  `assignedAt` timestamp(3) NOT NULL DEFAULT (now()),
  `lastReadingAt` timestamp(3) NULL DEFAULT NULL,
  `isActive` boolean NOT NULL DEFAULT true,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_appliance_monitor_appliance` (`applianceId`),
  KEY `idx_appliance_monitor_home` (`homeId`),
  KEY `idx_appliance_monitor_device` (`connectedDeviceId`),
  CONSTRAINT `fk_appliance_monitor_appliance` FOREIGN KEY (`applianceId`) REFERENCES `appliances`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `fk_appliance_monitor_home` FOREIGN KEY (`homeId`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `fk_appliance_monitor_device` FOREIGN KEY (`connectedDeviceId`) REFERENCES `devices`(`id`) ON DELETE set null ON UPDATE no action
);

-- Create anomaly_events table
CREATE TABLE `anomaly_events` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `applianceId` char(36) NOT NULL,
  `homeId` char(36) NOT NULL,
  `type` enum('high_consumption','unusual_standby','long_operating_period','consumption_spike','temperature_anomaly','baseline_degradation') NOT NULL,
  `severity` enum('low','medium','high','critical') NOT NULL DEFAULT 'low',
  `detectedAt` timestamp(3) NOT NULL DEFAULT (now()),
  `description` varchar(512) NOT NULL,
  `currentKwh` double NOT NULL DEFAULT 0,
  `baselineKwh` double NOT NULL DEFAULT 0,
  `percentageDeviation` double NOT NULL DEFAULT 0,
  `durationDays` int NOT NULL DEFAULT 0,
  `status` enum('active','resolved','acknowledged') NOT NULL DEFAULT 'active',
  `acknowledgedAt` timestamp(3) NULL DEFAULT NULL,
  `resolvedAt` timestamp(3) NULL DEFAULT NULL,
  `metadata` json NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_anomaly_appliance_time` (`applianceId`,`detectedAt`),
  KEY `idx_anomaly_type` (`type`),
  KEY `idx_anomaly_status` (`status`),
  CONSTRAINT `fk_anomaly_appliance` FOREIGN KEY (`applianceId`) REFERENCES `appliances`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `fk_anomaly_home` FOREIGN KEY (`homeId`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action
);

-- Create appliance_health_assessments table
CREATE TABLE `appliance_health_assessments` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `applianceId` char(36) NOT NULL,
  `homeId` char(36) NOT NULL,
  `assessedAt` timestamp(3) NOT NULL DEFAULT (now()),
  `healthStatus` enum('normal','monitoring','attention_required','service_recommended','critical_warning','insufficient_data') NOT NULL DEFAULT 'normal',
  `consumptionTrend` enum('improving','stable','deteriorating') NOT NULL DEFAULT 'stable',
  `anomalyFrequency` int NOT NULL DEFAULT 0,
  `lastAnomalyAt` timestamp(3) NULL DEFAULT NULL,
  `monitoringConfidence` double NOT NULL DEFAULT 0,
  `lastCheckedAt` timestamp(3) NOT NULL DEFAULT (now()),
  `readingsCount` int NOT NULL DEFAULT 0,
  `details` json NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_health_assessment_appliance_latest` (`applianceId`),
  KEY `idx_health_appliance` (`applianceId`),
  KEY `idx_health_last_checked` (`lastCheckedAt`),
  CONSTRAINT `fk_health_appliance` FOREIGN KEY (`applianceId`) REFERENCES `appliances`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `fk_health_home` FOREIGN KEY (`homeId`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action
);

-- Create maintenance_records table
CREATE TABLE `maintenance_records` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `applianceId` char(36) NOT NULL,
  `homeId` char(36) NOT NULL,
  `performedAt` timestamp(3) NOT NULL DEFAULT (now()),
  `type` enum('inspection','cleaning','service','repair','part_replacement') NOT NULL,
  `status` enum('completed','issue_unresolved','technician_contacted') NOT NULL DEFAULT 'completed',
  `technicianName` varchar(120) NULL DEFAULT NULL,
  `technicianContact` varchar(120) NULL DEFAULT NULL,
  `serviceNotes` text NULL DEFAULT NULL,
  `costCurrency` char(3) NULL DEFAULT 'INR',
  `costAmount` double NULL DEFAULT NULL,
  `postServiceKwh` double NULL DEFAULT NULL,
  `baselineKwhBefore` double NULL DEFAULT NULL,
  `energySavingsClaimed` double NULL DEFAULT NULL,
  `warrantyClaimed` boolean NOT NULL DEFAULT false,
  `warrantyExpiry` timestamp(3) NULL DEFAULT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `idx_maintenance_appliance` (`applianceId`),
  KEY `idx_maintenance_performed` (`performedAt`),
  CONSTRAINT `fk_maintenance_appliance` FOREIGN KEY (`applianceId`) REFERENCES `appliances`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `fk_maintenance_home` FOREIGN KEY (`homeId`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action
);

-- Create service_requests table (optional integration)
CREATE TABLE `service_requests` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `applianceId` char(36) NOT NULL,
  `homeId` char(36) NOT NULL,
  `requestedAt` timestamp(3) NOT NULL DEFAULT (now()),
  `requestedBy` char(36) NOT NULL,
  `status` enum('pending','accepted','in_progress','completed','cancelled') NOT NULL DEFAULT 'pending',
  `serviceType` enum('repair','maintenance','installation') NULL DEFAULT NULL,
  `preferredTechnician` varchar(120) NULL DEFAULT NULL,
  `assignedTechnician` varchar(120) NULL DEFAULT NULL,
  `appointmentDate` timestamp(3) NULL DEFAULT NULL,
  `addressProvided` text NULL DEFAULT NULL,
  `description` text NULL DEFAULT NULL,
  `costEstimate` double NULL DEFAULT NULL,
  `actualCost` double NULL DEFAULT NULL,
  `resolvedAt` timestamp(3) NULL DEFAULT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `idx_service_appliance` (`applianceId`),
  KEY `idx_service_status` (`status`),
  CONSTRAINT `fk_service_appliance` FOREIGN KEY (`applianceId`) REFERENCES `appliances`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `fk_service_home` FOREIGN KEY (`homeId`) REFERENCES `homes`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `fk_service_requested_by` FOREIGN KEY (`requestedBy`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action
);

-- Update energy_aggregates to include appliance-specific aggregates
ALTER TABLE `energy_aggregates`
  ADD COLUMN `applianceId` char(36) NULL DEFAULT NULL AFTER `deviceId`,
  ADD INDEX `idx_aggregates_appliance` (`applianceId`),
  ADD CONSTRAINT `fk_aggregates_appliance` FOREIGN KEY (`applianceId`) REFERENCES `appliances`(`id`) ON DELETE set null ON UPDATE no action;

-- Add index on appliance_usage for efficient lookups
CREATE INDEX `idx_appliance_usage_appliance` ON `appliance_usage` (`applianceId`);
