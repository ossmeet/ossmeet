CREATE TABLE `upload_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`principal` text NOT NULL,
	`scope` text NOT NULL,
	`bytes` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "upload_reservations_principal_length_check" CHECK(length(`principal`) <= 255 AND length(trim(`principal`)) BETWEEN 1 AND 255),
	CONSTRAINT "upload_reservations_scope_length_check" CHECK(length(`scope`) <= 255 AND length(trim(`scope`)) BETWEEN 1 AND 255),
	CONSTRAINT "upload_reservations_bytes_positive_check" CHECK(`bytes` > 0),
	CONSTRAINT "upload_reservations_expires_after_created_check" CHECK(`expires_at` > `created_at`)
);
--> statement-breakpoint
CREATE INDEX `upload_reservations_principal_expires_idx` ON `upload_reservations` (`principal`,`expires_at`);--> statement-breakpoint
CREATE INDEX `upload_reservations_expires_idx` ON `upload_reservations` (`expires_at`);
