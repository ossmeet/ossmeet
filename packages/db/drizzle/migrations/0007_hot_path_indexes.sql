CREATE INDEX `meeting_admissions_session_status_created_idx` ON `meeting_admissions` (`session_id`,`admission_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `meeting_livekit_presences_session_admission_status_updated_idx` ON `meeting_livekit_presences` (`session_id`,`admission_id`,`presence_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `meeting_livekit_presences_session_status_connected_idx` ON `meeting_livekit_presences` (`session_id`,`presence_status`,`connected_at`,`token_issued_at`,`id`);--> statement-breakpoint
CREATE INDEX `meeting_livekit_presences_user_status_session_idx` ON `meeting_livekit_presences` (`user_id`,`presence_status`,`session_id`);--> statement-breakpoint
CREATE INDEX `meeting_livekit_presences_user_session_idx` ON `meeting_livekit_presences` (`user_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `meeting_artifacts_space_created_id_idx` ON `meeting_artifacts` (`space_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `space_assets_space_created_id_idx` ON `space_assets` (`space_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `rooms_host_type_archived_last_used_idx` ON `rooms` (`host_id`,`type`,`archived_at`,`last_used_at`);
