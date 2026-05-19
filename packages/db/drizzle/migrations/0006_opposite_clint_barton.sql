PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_meeting_admissions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_user_id` text,
	`guest_secret_hash` text,
	`display_name` text NOT NULL,
	`requested_role` text NOT NULL,
	`granted_role` text,
	`admission_status` text DEFAULT 'awaiting_approval' NOT NULL,
	`decision_reason` text,
	`decided_by_user_id` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `meeting_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meeting_admissions_subject_type_check" CHECK("__new_meeting_admissions"."subject_type" in ('user', 'guest')),
	CONSTRAINT "meeting_admissions_requested_role_check" CHECK("__new_meeting_admissions"."requested_role" in ('host', 'participant', 'guest')),
	CONSTRAINT "meeting_admissions_granted_role_check" CHECK("__new_meeting_admissions"."granted_role" IS NULL OR "__new_meeting_admissions"."granted_role" IN ('host', 'participant', 'guest')),
	CONSTRAINT "meeting_admissions_status_check" CHECK("__new_meeting_admissions"."admission_status" in ('awaiting_approval', 'approved', 'denied', 'revoked')),
	CONSTRAINT "meeting_admissions_subject_shape_check" CHECK((
        ("__new_meeting_admissions"."subject_type" = 'user' AND "__new_meeting_admissions"."subject_user_id" IS NOT NULL AND "__new_meeting_admissions"."guest_secret_hash" IS NULL)
        OR (
          "__new_meeting_admissions"."subject_type" = 'guest'
          AND "__new_meeting_admissions"."subject_user_id" IS NULL
          AND (
            "__new_meeting_admissions"."guest_secret_hash" IS NOT NULL
            OR "__new_meeting_admissions"."admission_status" IN ('denied', 'revoked')
          )
        )
      )),
	CONSTRAINT "meeting_admissions_decision_shape_check" CHECK((
        ("__new_meeting_admissions"."admission_status" = 'approved' AND "__new_meeting_admissions"."granted_role" IS NOT NULL AND "__new_meeting_admissions"."decided_at" IS NOT NULL)
        OR ("__new_meeting_admissions"."admission_status" IN ('denied', 'revoked') AND "__new_meeting_admissions"."decided_at" IS NOT NULL)
        OR ("__new_meeting_admissions"."admission_status" = 'awaiting_approval' AND "__new_meeting_admissions"."granted_role" IS NULL AND "__new_meeting_admissions"."decided_at" IS NULL)
      )),
	CONSTRAINT "meeting_admissions_timestamps_check" CHECK((
        "__new_meeting_admissions"."updated_at" >= "__new_meeting_admissions"."created_at"
        AND ("__new_meeting_admissions"."decided_at" IS NULL OR "__new_meeting_admissions"."decided_at" >= "__new_meeting_admissions"."created_at")
      )),
	CONSTRAINT "meeting_admissions_display_name_length_check" CHECK(length("__new_meeting_admissions"."display_name") <= 100 AND length(trim("__new_meeting_admissions"."display_name")) BETWEEN 1 AND 100),
	CONSTRAINT "meeting_admissions_guest_secret_hash_length_check" CHECK("__new_meeting_admissions"."guest_secret_hash" IS NULL OR length("__new_meeting_admissions"."guest_secret_hash") <= 255),
	CONSTRAINT "meeting_admissions_decision_reason_length_check" CHECK("__new_meeting_admissions"."decision_reason" IS NULL OR length("__new_meeting_admissions"."decision_reason") <= 500)
);
--> statement-breakpoint
INSERT INTO `__new_meeting_admissions`(
  "id",
  "session_id",
  "subject_type",
  "subject_user_id",
  "guest_secret_hash",
  "display_name",
  "requested_role",
  "granted_role",
  "admission_status",
  "decision_reason",
  "decided_by_user_id",
  "decided_at",
  "created_at",
  "updated_at"
)
SELECT
  ma."id",
  ma."session_id",
  ma."subject_type",
  ma."subject_user_id",
  CASE
    WHEN ma."subject_type" = 'guest'
      THEN mp."guest_secret"
    ELSE NULL
  END,
  ma."display_name",
  ma."requested_role",
  CASE
    WHEN ma."admission_status" = 'approved' AND NOT (ma."subject_type" = 'guest' AND mp."guest_secret" IS NULL) THEN ma."requested_role"
    ELSE NULL
  END,
  CASE
    WHEN ma."subject_type" = 'guest' AND mp."guest_secret" IS NULL THEN 'revoked'
    WHEN ma."admission_status" = 'requested' THEN 'awaiting_approval'
    ELSE ma."admission_status"
  END,
  CASE
    WHEN ma."subject_type" = 'guest' AND mp."guest_secret" IS NULL THEN 'Legacy guest credential unavailable during migration'
    ELSE ma."decision_reason"
  END,
  ma."approved_by_user_id",
  CASE
    WHEN ma."subject_type" = 'guest' AND mp."guest_secret" IS NULL THEN
      CASE
        WHEN COALESCE(ma."updated_at", ma."created_at") < ma."created_at" THEN ma."created_at"
        ELSE COALESCE(ma."updated_at", ma."created_at")
      END
    WHEN ma."admission_status" = 'approved' THEN
      CASE
        WHEN COALESCE(ma."approved_at", ma."updated_at", ma."created_at") < ma."created_at" THEN ma."created_at"
        ELSE COALESCE(ma."approved_at", ma."updated_at", ma."created_at")
      END
    WHEN ma."admission_status" = 'denied' THEN
      CASE
        WHEN COALESCE(ma."denied_at", ma."updated_at", ma."created_at") < ma."created_at" THEN ma."created_at"
        ELSE COALESCE(ma."denied_at", ma."updated_at", ma."created_at")
      END
    WHEN ma."admission_status" = 'revoked' THEN
      CASE
        WHEN COALESCE(ma."updated_at", ma."created_at") < ma."created_at" THEN ma."created_at"
        ELSE COALESCE(ma."updated_at", ma."created_at")
      END
    ELSE NULL
  END,
  ma."created_at",
  CASE
    WHEN ma."updated_at" < ma."created_at" THEN ma."created_at"
    ELSE ma."updated_at"
  END
FROM `meeting_admissions` ma
LEFT JOIN `meeting_participants` mp ON mp."id" = ma."legacy_participant_id";--> statement-breakpoint
INSERT INTO `__new_meeting_admissions`(
  "id",
  "session_id",
  "subject_type",
  "subject_user_id",
  "guest_secret_hash",
  "display_name",
  "requested_role",
  "granted_role",
  "admission_status",
  "decision_reason",
  "decided_by_user_id",
  "decided_at",
  "created_at",
  "updated_at"
)
SELECT
  'mad_' || mp."id",
  mp."session_id",
  CASE WHEN mp."user_id" IS NULL THEN 'guest' ELSE 'user' END,
  mp."user_id",
  CASE WHEN mp."user_id" IS NULL THEN mp."guest_secret" ELSE NULL END,
  mp."display_name",
  mp."role",
  CASE WHEN mp."status" IN ('pending', 'active', 'left', 'aborted') THEN mp."role" ELSE NULL END,
  CASE
    WHEN mp."status" = 'awaiting_approval' THEN 'awaiting_approval'
    WHEN mp."status" = 'denied' THEN 'denied'
    ELSE 'approved'
  END,
  NULL,
  NULL,
  CASE
    WHEN mp."status" = 'denied' THEN
      CASE WHEN COALESCE(mp."left_at", mp."joined_at") < mp."joined_at" THEN mp."joined_at" ELSE COALESCE(mp."left_at", mp."joined_at") END
    WHEN mp."status" != 'awaiting_approval' THEN mp."joined_at"
    ELSE NULL
  END,
  mp."joined_at",
  CASE
    WHEN COALESCE(mp."left_at", mp."joined_at") < mp."joined_at" THEN mp."joined_at"
    ELSE COALESCE(mp."left_at", mp."joined_at")
  END
FROM `meeting_participants` mp
WHERE NOT EXISTS (
  SELECT 1
  FROM `meeting_admissions` ma
  WHERE ma."session_id" = mp."session_id"
    AND ma."legacy_participant_id" = mp."id"
);--> statement-breakpoint
CREATE TABLE `__new_meeting_livekit_presences` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`admission_id` text NOT NULL,
	`livekit_identity` text NOT NULL,
	`livekit_participant_sid` text,
	`user_id` text,
	`role` text NOT NULL,
	`presence_status` text DEFAULT 'token_issued' NOT NULL,
	`disconnect_reason` text,
	`token_issued_at` integer NOT NULL,
	`connected_at` integer,
	`disconnected_at` integer,
	`last_webhook_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `meeting_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`admission_id`) REFERENCES `meeting_admissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meeting_livekit_presences_role_check" CHECK("__new_meeting_livekit_presences"."role" in ('host', 'participant', 'guest')),
	CONSTRAINT "meeting_livekit_presences_status_check" CHECK("__new_meeting_livekit_presences"."presence_status" in ('token_issued', 'connected', 'disconnected', 'aborted')),
	CONSTRAINT "meeting_livekit_presences_timestamp_shape_check" CHECK((
        "__new_meeting_livekit_presences"."connected_at" IS NULL OR "__new_meeting_livekit_presences"."connected_at" >= "__new_meeting_livekit_presences"."token_issued_at"
      ) AND (
        "__new_meeting_livekit_presences"."disconnected_at" IS NULL OR "__new_meeting_livekit_presences"."disconnected_at" >= "__new_meeting_livekit_presences"."token_issued_at"
      ) AND (
        "__new_meeting_livekit_presences"."last_webhook_at" IS NULL OR "__new_meeting_livekit_presences"."last_webhook_at" >= "__new_meeting_livekit_presences"."token_issued_at"
      ) AND "__new_meeting_livekit_presences"."updated_at" >= "__new_meeting_livekit_presences"."created_at"),
	CONSTRAINT "meeting_livekit_presences_livekit_identity_length_check" CHECK(length("__new_meeting_livekit_presences"."livekit_identity") <= 200 AND length(trim("__new_meeting_livekit_presences"."livekit_identity")) BETWEEN 1 AND 200),
	CONSTRAINT "meeting_livekit_presences_livekit_sid_length_check" CHECK("__new_meeting_livekit_presences"."livekit_participant_sid" IS NULL OR length("__new_meeting_livekit_presences"."livekit_participant_sid") <= 200),
	CONSTRAINT "meeting_livekit_presences_disconnect_reason_length_check" CHECK("__new_meeting_livekit_presences"."disconnect_reason" IS NULL OR length("__new_meeting_livekit_presences"."disconnect_reason") <= 200)
);
--> statement-breakpoint
INSERT INTO `__new_meeting_livekit_presences`(
  "id",
  "session_id",
  "admission_id",
  "livekit_identity",
  "livekit_participant_sid",
  "user_id",
  "role",
  "presence_status",
  "disconnect_reason",
  "token_issued_at",
  "connected_at",
  "disconnected_at",
  "last_webhook_at",
  "created_at",
  "updated_at"
)
SELECT
  mc."id",
  mc."session_id",
  COALESCE(mc."admission_id", ma."id", 'mad_' || mc."legacy_participant_id"),
  mc."livekit_identity",
  mc."livekit_participant_sid",
  mc."user_id",
  mc."role_at_connect",
  mc."connection_status",
  mc."disconnect_reason",
  mc."token_issued_at",
  mc."connected_at",
  mc."disconnected_at",
  mc."last_webhook_at",
  mc."created_at",
  CASE
    WHEN mc."updated_at" < mc."created_at" THEN mc."created_at"
    ELSE mc."updated_at"
  END
FROM `meeting_connections` mc
LEFT JOIN `meeting_admissions` ma
  ON ma."session_id" = mc."session_id"
 AND ma."legacy_participant_id" = mc."legacy_participant_id"
WHERE COALESCE(mc."admission_id", ma."id", mc."legacy_participant_id") IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`admission_id` text,
	`connection_id` text,
	`participant_identity` text NOT NULL,
	`participant_name` text NOT NULL,
	`text` text NOT NULL,
	`segment_id` text NOT NULL,
	`language` text,
	`speaker_id` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `meeting_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`admission_id`) REFERENCES `meeting_admissions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`connection_id`) REFERENCES `__new_meeting_livekit_presences`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "transcripts_updated_after_started_check" CHECK("__new_transcripts"."updated_at" >= "__new_transcripts"."started_at"),
	CONSTRAINT "transcripts_participant_identity_length_check" CHECK(length("__new_transcripts"."participant_identity") <= 200 AND length(trim("__new_transcripts"."participant_identity")) BETWEEN 1 AND 200),
	CONSTRAINT "transcripts_participant_name_length_check" CHECK(length("__new_transcripts"."participant_name") <= 100 AND length(trim("__new_transcripts"."participant_name")) BETWEEN 1 AND 100),
	CONSTRAINT "transcripts_text_length_check" CHECK(length("__new_transcripts"."text") <= 32768 AND length(trim("__new_transcripts"."text")) BETWEEN 1 AND 32768),
	CONSTRAINT "transcripts_segment_id_length_check" CHECK(length("__new_transcripts"."segment_id") <= 255 AND length(trim("__new_transcripts"."segment_id")) BETWEEN 1 AND 255),
	CONSTRAINT "transcripts_language_length_check" CHECK("__new_transcripts"."language" IS NULL OR length("__new_transcripts"."language") <= 35),
	CONSTRAINT "transcripts_speaker_id_length_check" CHECK("__new_transcripts"."speaker_id" IS NULL OR length("__new_transcripts"."speaker_id") <= 200)
);
--> statement-breakpoint
INSERT INTO `__new_transcripts`(
  "id",
  "session_id",
  "admission_id",
  "connection_id",
  "participant_identity",
  "participant_name",
  "text",
  "segment_id",
  "language",
  "speaker_id",
  "started_at",
  "updated_at"
)
SELECT
  tr."id",
  tr."session_id",
  COALESCE(ma."id", CASE WHEN tr."participant_id" IS NOT NULL THEN 'mad_' || tr."participant_id" ELSE NULL END),
  mc."id",
  tr."participant_identity",
  tr."participant_name",
  tr."text",
  tr."segment_id",
  tr."language",
  tr."speaker_id",
  tr."started_at",
  CASE
    WHEN tr."updated_at" < tr."started_at" THEN tr."started_at"
    ELSE tr."updated_at"
  END
FROM `transcripts` tr
LEFT JOIN `meeting_admissions` ma
  ON ma."session_id" = tr."session_id"
 AND ma."legacy_participant_id" = tr."participant_id"
LEFT JOIN `meeting_connections` mc
  ON mc."session_id" = tr."session_id"
 AND mc."livekit_identity" = tr."participant_identity";--> statement-breakpoint
DROP TABLE `transcripts`;--> statement-breakpoint
DROP TABLE `meeting_connections`;--> statement-breakpoint
DROP TABLE `meeting_admissions`;--> statement-breakpoint
DROP TABLE `meeting_participants`;--> statement-breakpoint
ALTER TABLE `__new_meeting_admissions` RENAME TO `meeting_admissions`;--> statement-breakpoint
CREATE INDEX `meeting_admissions_session_status_idx` ON `meeting_admissions` (`session_id`,`admission_status`);--> statement-breakpoint
CREATE INDEX `meeting_admissions_session_user_idx` ON `meeting_admissions` (`session_id`,`subject_user_id`);--> statement-breakpoint
CREATE INDEX `meeting_admissions_session_created_idx` ON `meeting_admissions` (`session_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `__new_meeting_livekit_presences` RENAME TO `meeting_livekit_presences`;--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_livekit_presences_session_identity_unique_idx` ON `meeting_livekit_presences` (`session_id`,`livekit_identity`);--> statement-breakpoint
CREATE INDEX `meeting_livekit_presences_session_admission_idx` ON `meeting_livekit_presences` (`session_id`,`admission_id`);--> statement-breakpoint
CREATE INDEX `meeting_livekit_presences_session_status_idx` ON `meeting_livekit_presences` (`session_id`,`presence_status`);--> statement-breakpoint
CREATE INDEX `meeting_livekit_presences_session_user_idx` ON `meeting_livekit_presences` (`session_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `__new_transcripts` RENAME TO `transcripts`;--> statement-breakpoint
CREATE INDEX `transcripts_session_id_started_at_idx` ON `transcripts` (`session_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `transcripts_session_id_participant_idx` ON `transcripts` (`session_id`,`participant_identity`);--> statement-breakpoint
CREATE INDEX `transcripts_session_id_admission_id_started_at_idx` ON `transcripts` (`session_id`,`admission_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `transcripts_session_id_connection_id_started_at_idx` ON `transcripts` (`session_id`,`connection_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcripts_segment_id_unique` ON `transcripts` (`session_id`,`segment_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
