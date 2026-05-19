ALTER TABLE `users` ADD `paddle_customer_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `paddle_subscription_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `subscription_status` text;--> statement-breakpoint
CREATE INDEX `users_paddle_customer_id_idx` ON `users` (`paddle_customer_id`);