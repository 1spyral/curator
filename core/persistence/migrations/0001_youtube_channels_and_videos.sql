CREATE TABLE `youtube_channels` (
	`youtube_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `youtube_videos` (
	`youtube_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`channel_id` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	`published_at` integer NOT NULL,
	`thumbnail_url` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `youtube_channels`(`youtube_id`) ON UPDATE no action ON DELETE restrict
);
