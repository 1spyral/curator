CREATE TABLE `video_recommendations` (
	`user_id` text NOT NULL,
	`youtube_id` text NOT NULL,
	`rationale` text NOT NULL,
	`recommended_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `youtube_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`youtube_id`) REFERENCES `youtube_videos`(`youtube_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `video_recommendations_youtube_id_idx` ON `video_recommendations` (`youtube_id`);--> statement-breakpoint
CREATE TABLE `watched_videos` (
	`user_id` text NOT NULL,
	`youtube_id` text NOT NULL,
	`watched_at` integer DEFAULT (unixepoch()) NOT NULL,
	`notes` text,
	`rating_half_stars` integer,
	PRIMARY KEY(`user_id`, `youtube_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`youtube_id`) REFERENCES `youtube_videos`(`youtube_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "watched_videos_rating_half_stars_check" CHECK(
    "watched_videos"."rating_half_stars" IS NULL OR (
      typeof("watched_videos"."rating_half_stars") = 'integer'
      AND "watched_videos"."rating_half_stars" BETWEEN 1 AND 10
    )
  )
);
--> statement-breakpoint
CREATE INDEX `watched_videos_youtube_id_idx` ON `watched_videos` (`youtube_id`);