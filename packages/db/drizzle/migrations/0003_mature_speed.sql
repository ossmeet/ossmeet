DROP INDEX `users_paddle_customer_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_paddle_customer_id_idx` ON `users` (`paddle_customer_id`);