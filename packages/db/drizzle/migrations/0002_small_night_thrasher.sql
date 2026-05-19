PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_meeting_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`public_slug` text NOT NULL,
	`title` text,
	`host_id` text NOT NULL,
	`space_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`allow_guests` integer DEFAULT false NOT NULL,
	`recording_enabled` integer DEFAULT false NOT NULL,
	`require_approval` integer DEFAULT false NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`occupying_participant_count` integer DEFAULT 0 NOT NULL,
	`active_egress_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`retain_until` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meeting_sessions_public_slug_length_check" CHECK(length("__new_meeting_sessions"."public_slug") <= 32 AND length(trim("__new_meeting_sessions"."public_slug")) BETWEEN 1 AND 32),
	CONSTRAINT "meeting_sessions_title_length_check" CHECK("__new_meeting_sessions"."title" IS NULL OR length("__new_meeting_sessions"."title") <= 200),
	CONSTRAINT "meeting_sessions_status_check" CHECK("__new_meeting_sessions"."status" in ('active', 'ended')),
	CONSTRAINT "meeting_sessions_lifecycle_check" CHECK((
        ("__new_meeting_sessions"."status" = 'active' AND "__new_meeting_sessions"."ended_at" IS NULL)
        OR ("__new_meeting_sessions"."status" = 'ended' AND "__new_meeting_sessions"."ended_at" IS NOT NULL)
      )),
	CONSTRAINT "meeting_sessions_ended_after_started_check" CHECK("__new_meeting_sessions"."ended_at" IS NULL OR "__new_meeting_sessions"."ended_at" >= "__new_meeting_sessions"."started_at"),
	CONSTRAINT "meeting_sessions_retain_after_end_check" CHECK("__new_meeting_sessions"."retain_until" IS NULL OR ("__new_meeting_sessions"."ended_at" IS NOT NULL AND "__new_meeting_sessions"."retain_until" >= "__new_meeting_sessions"."ended_at")),
	CONSTRAINT "meeting_sessions_updated_after_started_check" CHECK("__new_meeting_sessions"."updated_at" >= "__new_meeting_sessions"."started_at"),
	CONSTRAINT "meeting_sessions_ended_egress_cleared_check" CHECK("__new_meeting_sessions"."status" = 'active' OR "__new_meeting_sessions"."active_egress_id" IS NULL),
	CONSTRAINT "meeting_sessions_occupying_count_nonnegative_check" CHECK("__new_meeting_sessions"."occupying_participant_count" >= 0),
	CONSTRAINT "meeting_sessions_ended_occupying_count_cleared_check" CHECK("__new_meeting_sessions"."status" = 'active' OR "__new_meeting_sessions"."occupying_participant_count" = 0)
);
--> statement-breakpoint
INSERT INTO `__new_meeting_sessions`("id", "room_id", "public_slug", "title", "host_id", "space_id", "status", "allow_guests", "recording_enabled", "require_approval", "locked", "occupying_participant_count", "active_egress_id", "started_at", "ended_at", "retain_until", "updated_at") SELECT "id", "room_id", "public_slug", "title", "host_id", "space_id", "status", "allow_guests", "recording_enabled", "require_approval", "locked", 0, "active_egress_id", "started_at", "ended_at", "retain_until", "updated_at" FROM `meeting_sessions`;--> statement-breakpoint
DROP TABLE `meeting_sessions`;--> statement-breakpoint
ALTER TABLE `__new_meeting_sessions` RENAME TO `meeting_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `meeting_sessions_room_status_idx` ON `meeting_sessions` (`room_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_sessions_active_room_unique_idx` ON `meeting_sessions` (`room_id`) WHERE "meeting_sessions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_sessions_room_public_slug_unique_idx` ON `meeting_sessions` (`room_id`,`public_slug`);--> statement-breakpoint
CREATE INDEX `meeting_sessions_space_id_status_idx` ON `meeting_sessions` (`space_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_sessions_host_id_status_idx` ON `meeting_sessions` (`host_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_sessions_status_started_at_idx` ON `meeting_sessions` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `meeting_sessions_retain_until_idx` ON `meeting_sessions` (`retain_until`);--> statement-breakpoint
UPDATE `meeting_sessions`
SET `occupying_participant_count` = (
	SELECT COUNT(*)
	FROM `meeting_participants`
	WHERE `meeting_participants`.`session_id` = `meeting_sessions`.`id`
	  AND `meeting_participants`.`status` IN ('awaiting_approval', 'pending', 'active')
)
WHERE `meeting_sessions`.`status` = 'active';--> statement-breakpoint
ALTER TABLE `users` ADD `subscription_updated_at` integer;
