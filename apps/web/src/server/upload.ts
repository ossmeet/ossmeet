import { createServerFn } from "@tanstack/react-start";
import { enforceRateLimit } from "./auth/helpers";
import { authMiddleware } from "./middleware";
import { AwsClient } from "aws4fetch";
import { z } from "zod";
import { getPlanLimits, Errors } from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { getUserStoredBytes } from "./assets/storage";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
] as const;

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const uploadSchema = z.object({
  filename: z.string().min(1).max(255)
    .refine((name) => !name.includes("/") && !name.includes("\\") && !name.includes(".."), "Invalid filename"),
  mimeType: z.string().refine(
    (type): type is typeof ALLOWED_MIME_TYPES[number] => (ALLOWED_MIME_TYPES as readonly string[]).includes(type),
    { message: `Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}` }
  ),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
  md5Hash: z.string().regex(/^[a-f0-9]{32}$/i, "Invalid MD5 hash").optional(),
});

/** Instantiate an R2-compatible S3 client with the account's credentials. */
export function buildR2Client(env: Env) {
  return {
    r2: new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    }),
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  };
}

export const getPresignedUploadUrl = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(uploadSchema)
  .handler(async ({ data, context: { user, env, db } }) => {

    await enforceRateLimit(env, `upload:${user.id}`);

    // Enforce per-user storage quota
    const limits = getPlanLimits((user.plan as PlanType) ?? "free");
    if (limits.maxStorageBytes !== null) {
      const usage = await getUserStoredBytes(db, user.id);
      if (usage + data.fileSize > limits.maxStorageBytes) {
        throw Errors.PLAN_LIMIT_REACHED("Storage quota exceeded");
      }
    }

    const safeR2Key = `uploads/${user.id}/${crypto.randomUUID()}-${data.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    const { r2, endpoint } = buildR2Client(env);
    const url = new URL(`/${env.R2_BUCKET_NAME}/${safeR2Key}`, endpoint);
    url.searchParams.set("X-Amz-Expires", "600");

    const headers: Record<string, string> = {
      "Content-Type": data.mimeType,
      "Content-Length": String(data.fileSize),
    };

    // Add checksum validation if provided (prevents corrupted uploads)
    if (data.md5Hash) {
      headers["Content-MD5"] = btoa(
        data.md5Hash.match(/.{2}/g)!.map(byte => String.fromCharCode(parseInt(byte, 16))).join('')
      );
    }

    const signed = await r2.sign(
      new Request(url.toString(), {
        method: "PUT",
        headers,
      }),
      { aws: { signQuery: true } }
    );

    return { uploadUrl: signed.url, r2Key: safeR2Key };
  });
