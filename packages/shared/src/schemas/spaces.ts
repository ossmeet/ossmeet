import { z } from "zod/v4";

export const createSpaceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().max(1000).optional(),
});

export const updateSpaceSchema = z.object({
  spaceId: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
});

export const addMemberSchema = z.object({
  spaceId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["admin", "member"]).optional().default("member"),
});

export const addMemberByEmailSchema = z.object({
  spaceId: z.string().min(1),
  email: z.string().email("Invalid email address").max(320),
  role: z.enum(["admin", "member"]).optional().default("member"),
});

export const createInviteSchema = z.object({
  spaceId: z.string().min(1),
  role: z.enum(["admin", "member"]).optional().default("member"),
  maxUses: z.number().int().positive().optional(),
  expiresInHours: z.number().int().positive().max(168).optional().default(24), // max 7 days
});

export const joinViaInviteSchema = z.object({
  token: z.string().min(1),
});

export const getSpaceSchema = z.object({
  spaceId: z.string().min(1),
});

export const deleteSpaceSchema = z.object({
  spaceId: z.string().min(1),
});

export const removeMemberSchema = z.object({
  spaceId: z.string().min(1),
  userId: z.string().min(1),
});

export const leaveSpaceSchema = z.object({
  spaceId: z.string().min(1),
});

export const listAssetsSchema = z.object({
  spaceId: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional().default(100),
  cursor: z.string().optional(), // asset ID for cursor-based pagination
});

export const getAssetUrlSchema = z.object({
  assetId: z.string().min(1),
});
