CREATE TABLE `meeting_admissions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_user_id` text,
	`guest_fingerprint` text,
	`display_name` text NOT NULL,
	`requested_role` text NOT NULL,
	`admission_status` text DEFAULT 'requested' NOT NULL,
	`decision_reason` text,
	`approved_by_user_id` text,
	`approved_at` integer,
	`denied_at` integer,
	`legacy_participant_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `meeting_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meeting_admissions_subject_type_check" CHECK("meeting_admissions"."subject_type" in ('user', 'guest')),
	CONSTRAINT "meeting_admissions_requested_role_check" CHECK("meeting_admissions"."requested_role" in ('host', 'participant', 'guest')),
	CONSTRAINT "meeting_admissions_status_check" CHECK("meeting_admissions"."admission_status" in ('requested', 'awaiting_approval', 'approved', 'denied', 'revoked')),
	CONSTRAINT "meeting_admissions_subject_shape_check" CHECK((
        ("meeting_admissions"."subject_type" = 'user' AND "meeting_admissions"."subject_user_id" IS NOT NULL AND "meeting_admissions"."guest_fingerprint" IS NULL)
        OR ("meeting_admissions"."subject_type" = 'guest' AND "meeting_admissions"."subject_user_id" IS NULL)
      )),
	CONSTRAINT "meeting_admissions_decision_timestamps_check" CHECK((
        ("meeting_admissions"."admission_status" = 'approved' AND "meeting_admissions"."approved_at" IS NOT NULL)
        OR ("meeting_admissions"."admission_status" = 'denied' AND "meeting_admissions"."denied_at" IS NOT NULL)
        OR ("meeting_admissions"."admission_status" IN ('requested', 'awaiting_approval', 'revoked'))
      )),
	CONSTRAINT "meeting_admissions_timestamps_order_check" CHECK((
        ("meeting_admissions"."approved_at" IS NULL OR "meeting_admissions"."approved_at" >= "meeting_admissions"."created_at")
        AND ("meeting_admissions"."denied_at" IS NULL OR "meeting_admissions"."denied_at" >= "meeting_admissions"."created_at")
        AND "meeting_admissions"."updated_at" >= "meeting_admissions"."created_at"
      )),
	CONSTRAINT "meeting_admissions_display_name_length_check" CHECK(length("meeting_admissions"."display_name") <= 100 AND length(trim("meeting_admissions"."display_name")) BETWEEN 1 AND 100),
	CONSTRAINT "meeting_admissions_guest_fingerprint_length_check" CHECK("meeting_admissions"."guest_fingerprint" IS NULL OR length("meeting_admissions"."guest_fingerprint") <= 255),
	CONSTRAINT "meeting_admissions_decision_reason_length_check" CHECK("meeting_admissions"."decision_reason" IS NULL OR length("meeting_admissions"."decision_reason") <= 500)
);
--> statement-breakpoint
CREATE INDEX `meeting_admissions_session_status_idx` ON `meeting_admissions` (`session_id`,`admission_status`);--> statement-breakpoint
CREATE INDEX `meeting_admissions_session_user_idx` ON `meeting_admissions` (`session_id`,`subject_user_id`);--> statement-breakpoint
CREATE INDEX `meeting_admissions_session_legacy_idx` ON `meeting_admissions` (`session_id`,`legacy_participant_id`);--> statement-breakpoint
CREATE TABLE `meeting_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`admission_id` text,
	`livekit_identity` text NOT NULL,
	`livekit_participant_sid` text,
	`user_id` text,
	`role_at_connect` text NOT NULL,
	`connection_status` text DEFAULT 'token_issued' NOT NULL,
	`disconnect_reason` text,
	`token_issued_at` integer NOT NULL,
	`connected_at` integer,
	`disconnected_at` integer,
	`last_webhook_at` integer,
	`legacy_participant_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `meeting_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`admission_id`) REFERENCES `meeting_admissions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meeting_connections_role_check" CHECK("meeting_connections"."role_at_connect" in ('host', 'participant', 'guest')),
	CONSTRAINT "meeting_connections_status_check" CHECK("meeting_connections"."connection_status" in ('token_issued', 'connected', 'disconnected')),
	CONSTRAINT "meeting_connections_timestamp_shape_check" CHECK((
        "meeting_connections"."connected_at" IS NULL OR "meeting_connections"."connected_at" >= "meeting_connections"."token_issued_at"
      ) AND (
        "meeting_connections"."disconnected_at" IS NULL OR "meeting_connections"."disconnected_at" >= "meeting_connections"."token_issued_at"
      ) AND (
        "meeting_connections"."last_webhook_at" IS NULL OR "meeting_connections"."last_webhook_at" >= "meeting_connections"."token_issued_at"
      ) AND "meeting_connections"."updated_at" >= "meeting_connections"."created_at"),
	CONSTRAINT "meeting_connections_livekit_identity_length_check" CHECK(length("meeting_connections"."livekit_identity") <= 200 AND length(trim("meeting_connections"."livekit_identity")) BETWEEN 1 AND 200),
	CONSTRAINT "meeting_connections_livekit_sid_length_check" CHECK("meeting_connections"."livekit_participant_sid" IS NULL OR length("meeting_connections"."livekit_participant_sid") <= 200),
	CONSTRAINT "meeting_connections_disconnect_reason_length_check" CHECK("meeting_connections"."disconnect_reason" IS NULL OR length("meeting_connections"."disconnect_reason") <= 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_connections_session_identity_unique_idx` ON `meeting_connections` (`session_id`,`livekit_identity`);--> statement-breakpoint
CREATE INDEX `meeting_connections_session_status_idx` ON `meeting_connections` (`session_id`,`connection_status`);--> statement-breakpoint
CREATE INDEX `meeting_connections_session_user_idx` ON `meeting_connections` (`session_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `meeting_connections_session_legacy_idx` ON `meeting_connections` (`session_id`,`legacy_participant_id`);--> statement-breakpoint
CREATE TABLE `meeting_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text,
	`payload` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `meeting_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meeting_events_kind_length_check" CHECK(length("meeting_events"."kind") <= 100 AND length(trim("meeting_events"."kind")) BETWEEN 1 AND 100),
	CONSTRAINT "meeting_events_subject_id_length_check" CHECK("meeting_events"."subject_id" IS NULL OR length("meeting_events"."subject_id") <= 255),
	CONSTRAINT "meeting_events_payload_json_check" CHECK("meeting_events"."payload" IS NULL OR json_valid("meeting_events"."payload")),
	CONSTRAINT "meeting_events_payload_length_check" CHECK("meeting_events"."payload" IS NULL OR length("meeting_events"."payload") <= 32768)
);
--> statement-breakpoint
CREATE INDEX `meeting_events_session_occurred_idx` ON `meeting_events` (`session_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `meeting_events_session_kind_idx` ON `meeting_events` (`session_id`,`kind`);--> statement-breakpoint
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
	CONSTRAINT "meeting_sessions_ended_egress_cleared_check" CHECK("__new_meeting_sessions"."status" = 'active' OR "__new_meeting_sessions"."active_egress_id" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_meeting_sessions`("id", "room_id", "public_slug", "title", "host_id", "space_id", "status", "allow_guests", "recording_enabled", "require_approval", "locked", "active_egress_id", "started_at", "ended_at", "retain_until", "updated_at") SELECT "id", "room_id", "public_slug", "title", "host_id", "space_id", "status", "allow_guests", "recording_enabled", "require_approval", "locked", "active_egress_id", "started_at", "ended_at", "retain_until", "updated_at" FROM `meeting_sessions`;--> statement-breakpoint
DROP TABLE `meeting_sessions`;--> statement-breakpoint
ALTER TABLE `__new_meeting_sessions` RENAME TO `meeting_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `meeting_sessions_room_status_idx` ON `meeting_sessions` (`room_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_sessions_active_room_unique_idx` ON `meeting_sessions` (`room_id`) WHERE "meeting_sessions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_sessions_room_public_slug_unique_idx` ON `meeting_sessions` (`room_id`,`public_slug`);--> statement-breakpoint
CREATE INDEX `meeting_sessions_space_id_status_idx` ON `meeting_sessions` (`space_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_sessions_host_id_status_idx` ON `meeting_sessions` (`host_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_sessions_status_started_at_idx` ON `meeting_sessions` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `meeting_sessions_retain_until_idx` ON `meeting_sessions` (`retain_until`);