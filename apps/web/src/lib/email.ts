import { escapeHtml } from "@ossmeet/shared";
import { logError } from "./logger";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send email via Resend REST API
 * Works on Cloudflare Workers without extra dependencies.
 */
export async function sendEmail(
  apiKey: string,
  options: SendEmailOptions
): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "OSSMeet <noreply@ossmeet.com>",
        to: [options.to],
        subject: options.subject,
        html: options.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      logError("[email] Resend API error", {
        provider: "resend",
        status: res.status,
        detail: summarizeProviderErrorBody(body),
      });
      return false;
    }
    return true;
  } catch (err) {
    logError("[email] Failed to send email:", err);
    return false;
  }
}

export function buildOtpEmail(otp: string, purpose: "signup" | "login" | "delete-account"): { subject: string; html: string } {
  const safeOtp = escapeHtml(otp);
  const title =
    purpose === "signup" ? "Verify your email" :
    purpose === "delete-account" ? "Confirm account deletion" :
    "Sign in to OSSMeet";
  const intro =
    purpose === "signup"
      ? "Welcome to OSSMeet! Use the code below to verify your email address."
      : purpose === "delete-account"
      ? "Someone requested to permanently delete your OSSMeet account. Use the code below to confirm. If you did not request this, do not use this code and your account will remain safe."
      : "Use the code below to sign in to your OSSMeet account.";

  return {
    subject: `${title} — OSSMeet`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 8px;">${title}</h2>
        <p style="color: #555;">${intro}</p>
        <div style="background: #f4f4f5; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; font-family: monospace;">${safeOtp}</span>
        </div>
        <p style="color: #888; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  };
}

export function summarizeProviderErrorBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const safeFields = ["name", "type", "code", "statusCode", "error"] as const;
    const summary = safeFields
      .filter((field) => parsed[field] !== undefined)
      .map((field) => `${field}=${String(parsed[field])}`)
      .join(" ");
    return summary || "[response body omitted]";
  } catch {
    return "[response body omitted]";
  }
}
