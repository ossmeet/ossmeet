declare global {
  interface Env {
    ALLOW_MEMORY_RATE_LIMIT?: string;
    PADDLE_API_KEY?: string;
    PADDLE_WEBHOOK_SECRET?: string;
    RESEND_FROM_ADDRESS?: string;
  }
}

export {};
