import { z } from "zod/v4";

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address").max(320),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address").max(320),
});

export const otpVerifySchema = z.object({
  email: z.string().email().max(320),
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
});

export const resendOtpSchema = z.object({
  email: z.string().email().max(320),
});

export const checkEmailSchema = z.object({
  email: z.string().email("Invalid email address").max(320),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
});

export const revokeSessionSchema = z.object({
  sessionId: z.string().min(1),
});

export const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE"),
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
});

export const requestAccountDeletionSchema = z.object({});

export const googleCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
