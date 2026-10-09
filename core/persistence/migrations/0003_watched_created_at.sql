CREATE TABLE `__new_watched_videos` (
	`user_id` text NOT NULL,
	`youtube_id` text NOT NULL,
	`watched_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`notes` text,
	`rating_half_stars` integer,
	PRIMARY KEY(`user_id`, `youtube_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`youtube_id`) REFERENCES `youtube_videos`(`youtube_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "watched_videos_rating_half_stars_check" CHECK (
		`rating_half_stars` IS NULL OR (
			typeof(`rating_half_stars`) = 'integer' AND `rating_half_stars` BETWEEN 1 AND 10
		)
	)
);
--> statement-breakpoint
INSERT INTO `__new_watched_videos` (
	`user_id`, `youtube_id`, `watched_at`, `created_at`, `notes`, `rating_half_stars`
)
SELECT `user_id`, `youtube_id`, `watched_at`, `watched_at`, `notes`, `rating_half_stars`
FROM `watched_videos`;
--> statement-breakpoint
DROP TABLE `watched_videos`;
--> statement-breakpoint
ALTER TABLE `__new_watched_videos` RENAME TO `watched_videos`;
--> statement-breakpoint
CREATE INDEX `watched_videos_youtube_id_idx` ON `watched_videos` (`youtube_id`);
