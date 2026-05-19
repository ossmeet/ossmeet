PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_meeting_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`space_id` text,
	`type` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `meeting_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meeting_artifacts_type_check" CHECK("__new_meeting_artifacts"."type" in ('recording', 'whiteboard_snapshot', 'whiteboard_state', 'whiteboard_pdf')),
	CONSTRAINT "meeting_artifacts_size_nonnegative_check" CHECK("__new_meeting_artifacts"."size" >= 0),
	CONSTRAINT "meeting_artifacts_filename_length_check" CHECK(length("__new_meeting_artifacts"."filename") <= 255 AND length(trim("__new_meeting_artifacts"."filename")) BETWEEN 1 AND 255),
	CONSTRAINT "meeting_artifacts_mime_type_length_check" CHECK(length("__new_meeting_artifacts"."mime_type") <= 100 AND length(trim("__new_meeting_artifacts"."mime_type")) BETWEEN 1 AND 100),
	CONSTRAINT "meeting_artifacts_r2_key_length_check" CHECK(length("__new_meeting_artifacts"."r2_key") <= 512),
	CONSTRAINT "meeting_artifacts_r2_key_check" CHECK((
        ("__new_meeting_artifacts"."type" = 'recording' AND "__new_meeting_artifacts"."r2_key" LIKE 'recordings/%')
        OR ("__new_meeting_artifacts"."type" = 'whiteboard_snapshot' AND "__new_meeting_artifacts"."r2_key" LIKE 'whiteboards/%')
        OR ("__new_meeting_artifacts"."type" IN ('whiteboard_state', 'whiteboard_pdf') AND "__new_meeting_artifacts"."r2_key" LIKE 'whiteboard/%')
      ))
);--> statement-breakpoint
INSERT INTO `__new_meeting_artifacts`(
  "id",
  "session_id",
  "space_id",
  "type",
  "r2_key",
  "filename",
  "mime_type",
  "size",
  "uploaded_by_id",
  "created_at"
)
SELECT
  "id",
  "session_id",
  "space_id",
  "type",
  CASE
    WHEN "type" IN ('whiteboard_state', 'whiteboard_pdf') AND "r2_key" LIKE 'whiteboard-tldraw/%'
      THEN 'whiteboard/' || substr("r2_key", 18)
    ELSE "r2_key"
  END,
  "filename",
  "mime_type",
  "size",
  "uploaded_by_id",
  "created_at"
FROM `meeting_artifacts`;--> statement-breakpoint
DROP TABLE `meeting_artifacts`;--> statement-breakpoint
ALTER TABLE `__new_meeting_artifacts` RENAME TO `meeting_artifacts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_artifacts_r2_key_unique` ON `meeting_artifacts` (`r2_key`);--> statement-breakpoint
CREATE INDEX `meeting_artifacts_session_id_created_at_idx` ON `meeting_artifacts` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `meeting_artifacts_space_id_created_at_idx` ON `meeting_artifacts` (`space_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `meeting_artifacts_session_type_idx` ON `meeting_artifacts` (`session_id`,`type`);--> statement-breakpoint
CREATE INDEX `meeting_artifacts_uploaded_by_id_idx` ON `meeting_artifacts` (`uploaded_by_id`);
