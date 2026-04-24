CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`linked_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_user_id_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_account_idx` ON `accounts` (`provider_id`,`provider_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_provider_idx` ON `accounts` (`user_id`,`provider_id`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "devices_token_hash_length_check" CHECK(length("devices"."token_hash") = 64),
	CONSTRAINT "devices_expires_after_created_check" CHECK("devices"."expires_at" >= "devices"."created_at"),
	CONSTRAINT "devices_last_seen_after_created_check" CHECK("devices"."last_seen_at" IS NULL OR "devices"."last_seen_at" >= "devices"."created_at"),
	CONSTRAINT "devices_label_length_check" CHECK("devices"."label" IS NULL OR length("devices"."label") <= 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `devices_user_id_idx` ON `devices` (`user_id`);--> statement-breakpoint
CREATE INDEX `devices_expires_at_idx` ON `devices` (`expires_at`);--> statement-breakpoint
CREATE TABLE `meeting_artifacts` (
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
	CONSTRAINT "meeting_artifacts_type_check" CHECK("meeting_artifacts"."type" in ('recording', 'whiteboard_snapshot', 'whiteboard_state', 'whiteboard_pdf')),
	CONSTRAINT "meeting_artifacts_size_nonnegative_check" CHECK("meeting_artifacts"."size" >= 0),
	CONSTRAINT "meeting_artifacts_filename_length_check" CHECK(length("meeting_artifacts"."filename") <= 255 AND length(trim("meeting_artifacts"."filename")) BETWEEN 1 AND 255),
	CONSTRAINT "meeting_artifacts_mime_type_length_check" CHECK(length("meeting_artifacts"."mime_type") <= 100 AND length(trim("meeting_artifacts"."mime_type")) BETWEEN 1 AND 100),
	CONSTRAINT "meeting_artifacts_r2_key_length_check" CHECK(length("meeting_artifacts"."r2_key") <= 512),
	CONSTRAINT "meeting_artifacts_r2_key_check" CHECK((
        ("meeting_artifacts"."type" = 'recording' AND "meeting_artifacts"."r2_key" LIKE 'recordings/%')
        OR ("meeting_artifacts"."type" = 'whiteboard_snapshot' AND "meeting_artifacts"."r2_key" LIKE 'whiteboards/%')
        OR ("meeting_artifacts"."type" IN ('whiteboard_state', 'whiteboard_pdf') AND "meeting_artifacts"."r2_key" LIKE 'whiteboard/%')
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_artifacts_r2_key_unique` ON `meeting_artifacts` (`r2_key`);--> statement-breakpoint
CREATE INDEX `meeting_artifacts_session_id_created_at_idx` ON `meeting_artifacts` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `meeting_artifacts_space_id_created_at_idx` ON `meeting_artifacts` (`space_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `meeting_artifacts_session_type_idx` ON `meeting_artifacts` (`session_id`,`type`);--> statement-breakpoint
CREATE INDEX `meeting_artifacts_uploaded_by_id_idx` ON `meeting_artifacts` (`uploaded_by_id`);--> statement-breakpoint
CREATE TABLE `meeting_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'participant' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`livekit_identity` text,
	`guest_secret` text,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `meeting_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meeting_participants_role_check" CHECK("meeting_participants"."role" in ('host', 'participant', 'guest')),
	CONSTRAINT "meeting_participants_status_check" CHECK("meeting_participants"."status" in ('awaiting_approval', 'pending', 'active', 'left', 'aborted', 'denied')),
	CONSTRAINT "meeting_participants_guest_shape_check" CHECK((
        ("meeting_participants"."user_id" IS NOT NULL AND "meeting_participants"."guest_secret" IS NULL AND "meeting_participants"."role" IN ('host', 'participant'))
        OR ("meeting_participants"."user_id" IS NULL AND "meeting_participants"."guest_secret" IS NOT NULL AND "meeting_participants"."role" = 'guest')
      )),
	CONSTRAINT "meeting_participants_terminal_left_at_check" CHECK((
        ("meeting_participants"."status" IN ('awaiting_approval', 'pending', 'active') AND "meeting_participants"."left_at" IS NULL)
        OR ("meeting_participants"."status" IN ('left', 'aborted', 'denied') AND "meeting_participants"."left_at" IS NOT NULL)
      )),
	CONSTRAINT "meeting_participants_left_after_join_check" CHECK("meeting_participants"."left_at" IS NULL OR "meeting_participants"."left_at" >= "meeting_participants"."joined_at"),
	CONSTRAINT "meeting_participants_display_name_length_check" CHECK(length("meeting_participants"."display_name") <= 100 AND length(trim("meeting_participants"."display_name")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE INDEX `meeting_participants_meeting_status_idx` ON `meeting_participants` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_participants_meeting_user_status_idx` ON `meeting_participants` (`session_id`,`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_participants_user_id_idx` ON `meeting_participants` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_participants_meeting_identity_unique_idx` ON `meeting_participants` (`session_id`,`livekit_identity`) WHERE "meeting_participants"."livekit_identity" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `meeting_participants_active_user_idx` ON `meeting_participants` (`session_id`,`user_id`) WHERE "meeting_participants"."status" IN ('pending', 'active') AND "meeting_participants"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `meeting_sessions` (
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
	CONSTRAINT "meeting_sessions_public_slug_length_check" CHECK(length("meeting_sessions"."public_slug") <= 32 AND length(trim("meeting_sessions"."public_slug")) BETWEEN 1 AND 32),
	CONSTRAINT "meeting_sessions_title_length_check" CHECK("meeting_sessions"."title" IS NULL OR length("meeting_sessions"."title") <= 200),
	CONSTRAINT "meeting_sessions_status_check" CHECK("meeting_sessions"."status" in ('active', 'ended')),
	CONSTRAINT "meeting_sessions_lifecycle_check" CHECK((
        ("meeting_sessions"."status" = 'active' AND "meeting_sessions"."ended_at" IS NULL)
        OR ("meeting_sessions"."status" = 'ended' AND "meeting_sessions"."ended_at" IS NOT NULL)
      )),
	CONSTRAINT "meeting_sessions_ended_after_started_check" CHECK("meeting_sessions"."ended_at" IS NULL OR "meeting_sessions"."ended_at" >= "meeting_sessions"."started_at"),
	CONSTRAINT "meeting_sessions_retain_after_end_check" CHECK("meeting_sessions"."retain_until" IS NULL OR ("meeting_sessions"."ended_at" IS NOT NULL AND "meeting_sessions"."retain_until" >= "meeting_sessions"."ended_at")),
	CONSTRAINT "meeting_sessions_updated_after_started_check" CHECK("meeting_sessions"."updated_at" >= "meeting_sessions"."started_at"),
	CONSTRAINT "meeting_sessions_ended_egress_cleared_check" CHECK("meeting_sessions"."status" = 'active' OR "meeting_sessions"."active_egress_id" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `meeting_sessions_room_status_idx` ON `meeting_sessions` (`room_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_sessions_active_room_unique_idx` ON `meeting_sessions` (`room_id`) WHERE "meeting_sessions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_sessions_room_public_slug_unique_idx` ON `meeting_sessions` (`room_id`,`public_slug`);--> statement-breakpoint
CREATE INDEX `meeting_sessions_space_id_status_idx` ON `meeting_sessions` (`space_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_sessions_host_id_status_idx` ON `meeting_sessions` (`host_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_sessions_status_started_at_idx` ON `meeting_sessions` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `meeting_sessions_retain_until_idx` ON `meeting_sessions` (`retain_until`);--> statement-breakpoint
CREATE TABLE `meeting_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`summary` text NOT NULL,
	`topics` text,
	`action_items` text,
	`decisions` text,
	`duration_seconds` integer,
	`participant_count` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `meeting_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meeting_summaries_topics_json_check" CHECK("meeting_summaries"."topics" IS NULL OR (json_valid("meeting_summaries"."topics") AND json_type("meeting_summaries"."topics") = 'array')),
	CONSTRAINT "meeting_summaries_topics_length_check" CHECK("meeting_summaries"."topics" IS NULL OR length("meeting_summaries"."topics") <= 32768),
	CONSTRAINT "meeting_summaries_action_items_json_check" CHECK("meeting_summaries"."action_items" IS NULL OR (json_valid("meeting_summaries"."action_items") AND json_type("meeting_summaries"."action_items") = 'array')),
	CONSTRAINT "meeting_summaries_action_items_length_check" CHECK("meeting_summaries"."action_items" IS NULL OR length("meeting_summaries"."action_items") <= 32768),
	CONSTRAINT "meeting_summaries_decisions_json_check" CHECK("meeting_summaries"."decisions" IS NULL OR (json_valid("meeting_summaries"."decisions") AND json_type("meeting_summaries"."decisions") = 'array')),
	CONSTRAINT "meeting_summaries_decisions_length_check" CHECK("meeting_summaries"."decisions" IS NULL OR length("meeting_summaries"."decisions") <= 32768),
	CONSTRAINT "meeting_summaries_duration_nonnegative_check" CHECK("meeting_summaries"."duration_seconds" IS NULL OR "meeting_summaries"."duration_seconds" >= 0),
	CONSTRAINT "meeting_summaries_participant_count_nonnegative_check" CHECK("meeting_summaries"."participant_count" IS NULL OR "meeting_summaries"."participant_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_summaries_session_id_unique` ON `meeting_summaries` (`session_id`);--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer DEFAULT false NOT NULL,
	`transports` text,
	`name` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "passkeys_credential_id_length_check" CHECK(length("passkeys"."credential_id") <= 1024),
	CONSTRAINT "passkeys_public_key_length_check" CHECK(length("passkeys"."public_key") <= 1024),
	CONSTRAINT "passkeys_device_type_check" CHECK("passkeys"."device_type" in ('singleDevice', 'multiDevice')),
	CONSTRAINT "passkeys_counter_nonnegative_check" CHECK("passkeys"."counter" >= 0),
	CONSTRAINT "passkeys_transports_json_check" CHECK("passkeys"."transports" IS NULL OR (json_valid("passkeys"."transports") AND json_type("passkeys"."transports") = 'array')),
	CONSTRAINT "passkeys_transports_length_check" CHECK("passkeys"."transports" IS NULL OR length("passkeys"."transports") <= 1024),
	CONSTRAINT "passkeys_last_used_after_created_check" CHECK("passkeys"."last_used_at" IS NULL OR "passkeys"."last_used_at" >= "passkeys"."created_at"),
	CONSTRAINT "passkeys_name_length_check" CHECK("passkeys"."name" IS NULL OR length("passkeys"."name") <= 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_credential_id_unique` ON `passkeys` (`credential_id`);--> statement-breakpoint
CREATE INDEX `passkeys_user_id_idx` ON `passkeys` (`user_id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`type` text DEFAULT 'instant' NOT NULL,
	`host_id` text NOT NULL,
	`space_id` text,
	`title` text,
	`allow_guests` integer DEFAULT false NOT NULL,
	`recording_enabled` integer DEFAULT false NOT NULL,
	`require_approval` integer DEFAULT false NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rooms_code_shape_check" CHECK(
    length("rooms"."code") = 12
    AND substr("rooms"."code", 4, 1) = '-'
    AND substr("rooms"."code", 9, 1) = '-'
    AND lower("rooms"."code") = "rooms"."code"
    AND substr("rooms"."code", 1, 1) BETWEEN 'a' AND 'z' AND substr("rooms"."code", 2, 1) BETWEEN 'a' AND 'z' AND substr("rooms"."code", 3, 1) BETWEEN 'a' AND 'z' AND substr("rooms"."code", 5, 1) BETWEEN 'a' AND 'z' AND substr("rooms"."code", 6, 1) BETWEEN 'a' AND 'z' AND substr("rooms"."code", 7, 1) BETWEEN 'a' AND 'z' AND substr("rooms"."code", 8, 1) BETWEEN 'a' AND 'z' AND substr("rooms"."code", 10, 1) BETWEEN 'a' AND 'z' AND substr("rooms"."code", 11, 1) BETWEEN 'a' AND 'z' AND substr("rooms"."code", 12, 1) BETWEEN 'a' AND 'z'
  ),
	CONSTRAINT "rooms_type_check" CHECK("rooms"."type" in ('instant', 'permanent')),
	CONSTRAINT "rooms_title_length_check" CHECK("rooms"."title" IS NULL OR length("rooms"."title") <= 200),
	CONSTRAINT "rooms_expiry_after_created_check" CHECK("rooms"."expires_at" IS NULL OR "rooms"."expires_at" >= "rooms"."created_at"),
	CONSTRAINT "rooms_last_used_after_created_check" CHECK("rooms"."last_used_at" IS NULL OR "rooms"."last_used_at" >= "rooms"."created_at"),
	CONSTRAINT "rooms_last_used_before_expiry_check" CHECK("rooms"."expires_at" IS NULL OR "rooms"."last_used_at" IS NULL OR "rooms"."last_used_at" <= "rooms"."expires_at"),
	CONSTRAINT "rooms_archived_after_created_check" CHECK("rooms"."archived_at" IS NULL OR "rooms"."archived_at" >= "rooms"."created_at"),
	CONSTRAINT "rooms_updated_after_created_check" CHECK("rooms"."updated_at" >= "rooms"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_code_unique` ON `rooms` (`code`);--> statement-breakpoint
CREATE INDEX `rooms_host_id_idx` ON `rooms` (`host_id`);--> statement-breakpoint
CREATE INDEX `rooms_host_last_used_idx` ON `rooms` (`host_id`,`last_used_at`);--> statement-breakpoint
CREATE INDEX `rooms_space_id_idx` ON `rooms` (`space_id`);--> statement-breakpoint
CREATE INDEX `rooms_expires_at_idx` ON `rooms` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`previous_token_hash` text,
	`rotation_version` integer DEFAULT 0 NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessions_token_hash_length_check" CHECK(length("sessions"."token_hash") = 64),
	CONSTRAINT "sessions_previous_token_hash_length_check" CHECK("sessions"."previous_token_hash" IS NULL OR length("sessions"."previous_token_hash") = 64),
	CONSTRAINT "sessions_expires_after_created_check" CHECK("sessions"."expires_at" >= "sessions"."created_at"),
	CONSTRAINT "sessions_absolute_expires_after_expires_check" CHECK("sessions"."absolute_expires_at" >= "sessions"."expires_at"),
	CONSTRAINT "sessions_last_seen_after_created_check" CHECK("sessions"."last_seen_at" IS NULL OR "sessions"."last_seen_at" >= "sessions"."created_at"),
	CONSTRAINT "sessions_ip_address_length_check" CHECK("sessions"."ip_address" IS NULL OR length("sessions"."ip_address") <= 64),
	CONSTRAINT "sessions_user_agent_length_check" CHECK("sessions"."user_agent" IS NULL OR length("sessions"."user_agent") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_absolute_expires_at_idx` ON `sessions` (`absolute_expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_previous_token_hash_idx` ON `sessions` (`previous_token_hash`);--> statement-breakpoint
CREATE TABLE `space_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text,
	`type` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "space_assets_type_check" CHECK("space_assets"."type" in ('pdf')),
	CONSTRAINT "space_assets_size_nonnegative_check" CHECK("space_assets"."size" >= 0),
	CONSTRAINT "space_assets_filename_length_check" CHECK(length("space_assets"."filename") <= 255 AND length(trim("space_assets"."filename")) BETWEEN 1 AND 255),
	CONSTRAINT "space_assets_mime_type_length_check" CHECK(length("space_assets"."mime_type") <= 100 AND length(trim("space_assets"."mime_type")) BETWEEN 1 AND 100),
	CONSTRAINT "space_assets_r2_key_length_check" CHECK(length("space_assets"."r2_key") <= 512),
	CONSTRAINT "space_assets_r2_key_check" CHECK("space_assets"."type" = 'pdf' AND ("space_assets"."r2_key" LIKE 'uploads/%' OR "space_assets"."r2_key" LIKE 'spaces/%'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_assets_r2_key_unique` ON `space_assets` (`r2_key`);--> statement-breakpoint
CREATE INDEX `space_assets_space_id_created_at_idx` ON `space_assets` (`space_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `space_assets_uploaded_by_id_idx` ON `space_assets` (`uploaded_by_id`);--> statement-breakpoint
CREATE TABLE `space_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`token` text NOT NULL,
	`created_by_id` text,
	`role` text DEFAULT 'member' NOT NULL,
	`expires_at` integer NOT NULL,
	`max_uses` integer,
	`use_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "space_invites_token_length_check" CHECK(length("space_invites"."token") = 64),
	CONSTRAINT "space_invites_role_check" CHECK("space_invites"."role" in ('admin', 'member')),
	CONSTRAINT "space_invites_use_count_nonnegative_check" CHECK("space_invites"."use_count" >= 0),
	CONSTRAINT "space_invites_max_uses_positive_check" CHECK("space_invites"."max_uses" IS NULL OR "space_invites"."max_uses" > 0),
	CONSTRAINT "space_invites_use_count_within_limit_check" CHECK("space_invites"."max_uses" IS NULL OR "space_invites"."use_count" <= "space_invites"."max_uses"),
	CONSTRAINT "space_invites_expiry_after_created_check" CHECK("space_invites"."expires_at" >= "space_invites"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_invites_token_unique` ON `space_invites` (`token`);--> statement-breakpoint
CREATE INDEX `space_invites_space_id_idx` ON `space_invites` (`space_id`);--> statement-breakpoint
CREATE INDEX `space_invites_expires_at_idx` ON `space_invites` (`expires_at`);--> statement-breakpoint
CREATE TABLE `space_members` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "space_members_role_check" CHECK("space_members"."role" in ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE INDEX `space_members_user_id_idx` ON `space_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `space_members_unique_idx` ON `space_members` (`space_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`slug` text NOT NULL,
	`owner_id` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "spaces_name_length_check" CHECK(length("spaces"."name") <= 200 AND length(trim("spaces"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "spaces_description_length_check" CHECK("spaces"."description" IS NULL OR length("spaces"."description") <= 1000),
	CONSTRAINT "spaces_slug_length_check" CHECK(length("spaces"."slug") <= 64 AND length(trim("spaces"."slug")) BETWEEN 1 AND 64),
	CONSTRAINT "spaces_slug_format_check" CHECK(
        lower("spaces"."slug") = "spaces"."slug"
        AND "spaces"."slug" GLOB '[a-z0-9]*'
        AND "spaces"."slug" NOT GLOB '*[^a-z0-9-]*'
        AND "spaces"."slug" NOT GLOB '*-'
      ),
	CONSTRAINT "spaces_updated_after_created_check" CHECK("spaces"."updated_at" >= "spaces"."created_at"),
	CONSTRAINT "spaces_archived_after_created_check" CHECK("spaces"."archived_at" IS NULL OR "spaces"."archived_at" >= "spaces"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spaces_slug_unique` ON `spaces` (`slug`);--> statement-breakpoint
CREATE INDEX `spaces_owner_id_idx` ON `spaces` (`owner_id`);--> statement-breakpoint
CREATE INDEX `spaces_owner_archived_idx` ON `spaces` (`owner_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`participant_id` text,
	`participant_identity` text NOT NULL,
	`participant_name` text NOT NULL,
	`text` text NOT NULL,
	`segment_id` text NOT NULL,
	`language` text,
	`speaker_id` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `meeting_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `meeting_participants`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "transcripts_updated_after_started_check" CHECK("transcripts"."updated_at" >= "transcripts"."started_at")
);
--> statement-breakpoint
CREATE INDEX `transcripts_session_id_started_at_idx` ON `transcripts` (`session_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `transcripts_session_id_participant_idx` ON `transcripts` (`session_id`,`participant_identity`);--> statement-breakpoint
CREATE INDEX `transcripts_session_id_participant_id_started_at_idx` ON `transcripts` (`session_id`,`participant_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcripts_segment_id_unique` ON `transcripts` (`session_id`,`segment_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`image` text,
	`plan` text DEFAULT 'free' NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_name_length_check" CHECK(length("users"."name") <= 100 AND length(trim("users"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "users_email_length_check" CHECK(length("users"."email") <= 320),
	CONSTRAINT "users_normalized_email_length_check" CHECK(length("users"."normalized_email") <= 320),
	CONSTRAINT "users_image_length_check" CHECK("users"."image" IS NULL OR length("users"."image") <= 2048),
	CONSTRAINT "users_updated_after_created_check" CHECK("users"."updated_at" >= "users"."created_at"),
	CONSTRAINT "users_plan_check" CHECK("users"."plan" in ('free', 'pro', 'org')),
	CONSTRAINT "users_role_check" CHECK("users"."role" in ('admin', 'user'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_normalized_email_unique` ON `users` (`normalized_email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`data` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "verifications_type_check" CHECK("verifications"."type" in ('otp_signup', 'otp_login', 'otp_account_delete', 'oauth_pkce', 'passkey_register', 'passkey_auth')),
	CONSTRAINT "verifications_data_json_check" CHECK("verifications"."data" IS NULL OR json_valid("verifications"."data")),
	CONSTRAINT "verifications_data_length_check" CHECK("verifications"."data" IS NULL OR length("verifications"."data") <= 32768),
	CONSTRAINT "verifications_expires_after_created_check" CHECK("verifications"."expires_at" >= "verifications"."created_at"),
	CONSTRAINT "verifications_updated_after_created_check" CHECK("verifications"."updated_at" >= "verifications"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verifications_type_identifier_unique` ON `verifications` (`type`,`identifier`);--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);--> statement-breakpoint
CREATE INDEX `verifications_expires_at_idx` ON `verifications` (`expires_at`);