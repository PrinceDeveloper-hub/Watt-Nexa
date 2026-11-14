CREATE TABLE `wattbot_knowledge_chunks` (
	`id` char(36) NOT NULL,
	`chunk_key` varchar(200) NOT NULL,
	`title` varchar(160) NOT NULL,
	`source` varchar(160) NOT NULL,
	`content` text NOT NULL,
	`content_hash` char(64) NOT NULL,
	`embedding` json,
	`embedding_model` varchar(80),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `wattbot_knowledge_chunks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_wattbot_knowledge_chunk` UNIQUE(`chunk_key`)
);
