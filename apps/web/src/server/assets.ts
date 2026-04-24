import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createDb } from "@ossmeet/db";
import { meetingArtifacts, meetingSessions, spaces, users, spaceAssets } from "@ossmeet/db/schema";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import {
  Errors,
  getAssetUrlSchema,
  getPlanLimits,
  listAssetsSchema,
  saveSessionAssetSchema,
} from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { enforceRateLimit, getClientIP, getEnv, requireAuth } from "./auth/helpers";
import { authMiddleware } from "./middleware";
import { logWarn } from "@/lib/logger";
import { buildR2Client } from "./upload";
import { assertSpaceMembership } from "./meetings/access-assertions";
import {
  registerMeetingArtifactMetadata,
  registerSpaceAssetMetadata,
} from "./assets/register";
import { getUserStoredBytes } from "./assets/storage";

type ListedAsset = {
  id: string;
  spaceId: string | null;
  type: string;
  r2Key: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedById: string | null;
  createdAt: Date;
};

function sortAssetsDesc(a: ListedAsset, b: ListedAsset): number {
  const createdDiff = b.createdAt.getTime() - a.createdAt.getTime();
  if (createdDiff !== 0) return createdDiff;
  return b.id.localeCompare(a.id);
}

export const listSpaceAssets = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(listAssetsSchema)
  .handler(async ({ data, context: { user, db } }) => {
    const space = await db.query.spaces.findFirst({
      where: and(eq(spaces.id, data.spaceId), isNull(spaces.archivedAt)),
      columns: { id: true },
    });
    if (!space) throw Errors.NOT_FOUND("Space");

    await assertSpaceMembership(db, data.spaceId, user.id);

    let cursorCreatedAt: Date | null = null;
    if (data.cursor) {
      const [spaceAsset, meetingArtifact] = await Promise.all([
        db.query.spaceAssets.findFirst({
          where: and(eq(spaceAssets.id, data.cursor), eq(spaceAssets.spaceId, data.spaceId)),
          columns: { createdAt: true },
        }),
        db.query.meetingArtifacts.findFirst({
          where: and(
            eq(meetingArtifacts.id, data.cursor),
            eq(meetingArtifacts.spaceId, data.spaceId),
          ),
          columns: { createdAt: true },
        }),
      ]);
      cursorCreatedAt = spaceAsset?.createdAt ?? meetingArtifact?.createdAt ?? null;
    }

    const limit = data.limit;
    const [spaceRows, meetingRows] = await Promise.all([
      db.query.spaceAssets.findMany({
        where: cursorCreatedAt
          ? and(eq(spaceAssets.spaceId, data.spaceId), lt(spaceAssets.createdAt, cursorCreatedAt))
          : eq(spaceAssets.spaceId, data.spaceId),
        orderBy: (table) => [desc(table.createdAt), desc(table.id)],
        limit: limit + 1,
      }),
      db.query.meetingArtifacts.findMany({
        where: cursorCreatedAt
          ? and(
              eq(meetingArtifacts.spaceId, data.spaceId),
              lt(meetingArtifacts.createdAt, cursorCreatedAt),
            )
          : eq(meetingArtifacts.spaceId, data.spaceId),
        orderBy: (table) => [desc(table.createdAt), desc(table.id)],
        limit: limit + 1,
      }),
    ]);

    const merged = [...spaceRows, ...meetingRows].sort(sortAssetsDesc);
    const hasMore = merged.length > limit;
    const assets = hasMore ? merged.slice(0, limit) : merged;
    const nextCursor = hasMore ? assets[assets.length - 1]?.id : undefined;

    return { assets, nextCursor };
  });

export const getAssetUrl = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(getAssetUrlSchema)
  .handler(async ({ data, context: { user, env, db } }) => {
    const [spaceAsset, meetingArtifact] = await Promise.all([
      db.query.spaceAssets.findFirst({
        where: eq(spaceAssets.id, data.assetId),
      }),
      db.query.meetingArtifacts.findFirst({
        where: eq(meetingArtifacts.id, data.assetId),
      }),
    ]);

    const asset = spaceAsset ?? meetingArtifact;
    if (!asset) throw Errors.NOT_FOUND("Asset");

    if (!asset.spaceId) {
      if (asset.uploadedById !== user.id) throw Errors.FORBIDDEN();
    } else {
      const assetSpace = await db.query.spaces.findFirst({
        where: and(eq(spaces.id, asset.spaceId), isNull(spaces.archivedAt)),
        columns: { id: true },
      });
      if (!assetSpace) throw Errors.NOT_FOUND("Space");

      await assertSpaceMembership(db, asset.spaceId, user.id);
    }

    const { r2, endpoint } = buildR2Client(env);
    const url = new URL(`/${env.R2_BUCKET_NAME}/${asset.r2Key}`, endpoint);
    url.searchParams.set("X-Amz-Expires", "3600");
    url.searchParams.set(
      "response-content-disposition",
      `attachment; filename="${encodeURIComponent(asset.filename ?? "download")}"`,
    );
    url.searchParams.set("response-cache-control", "public, max-age=3600");

    const signed = await r2.sign(new Request(url.toString()), {
      aws: { signQuery: true },
    });

    return { url: signed.url };
  });

export const saveSessionAsset = createServerFn({ method: "POST" })
  .inputValidator(saveSessionAssetSchema)
  .handler(async ({ data }) => {
    const request = getRequest();
    const env = await getEnv();
    const db = createDb(env.DB);

    const internalSecret = request.headers.get("X-Whiteboard-Secret");
    await enforceRateLimit(env, `asset:save:${getClientIP()}`);

    let uploadedById: string;
    let userPlan: string | undefined;
    let registerAsMeetingArtifact = false;
    let meetingArtifactType: typeof meetingArtifacts.$inferInsert.type | null = null;

    const enc = new TextEncoder();
    let secretValid = false;
    if (internalSecret && env.WHITEBOARD_INTERNAL_SECRET) {
      const hmacKey = await crypto.subtle.importKey(
        "raw",
        enc.encode(env.WHITEBOARD_INTERNAL_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const fixedMsg = enc.encode("ossmeet-whiteboard-auth");
      const providedKeyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(internalSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const providedDigest = new Uint8Array(
        await crypto.subtle.sign("HMAC", providedKeyMaterial, fixedMsg),
      );
      const expectedDigest = new Uint8Array(
        await crypto.subtle.sign("HMAC", hmacKey, fixedMsg),
      );
      secretValid = crypto.subtle.timingSafeEqual(providedDigest, expectedDigest);
    }

    if (secretValid) {
      if (data.type === "pdf") {
        throw Errors.VALIDATION("Server-to-server asset registration only supports meeting artifacts");
      }
      if (!data.sessionId) {
        throw Errors.VALIDATION("sessionId is required for server-to-server calls");
      }

      const meeting = await db.query.meetingSessions.findFirst({
        where: and(eq(meetingSessions.id, data.sessionId), eq(meetingSessions.spaceId, data.spaceId)),
        columns: { id: true, hostId: true },
      });
      if (!meeting) throw Errors.VALIDATION("Meeting does not belong to this space");

      const validPrefix =
        data.r2Key.startsWith("recordings/") ||
        data.r2Key.startsWith("whiteboards/") ||
        data.r2Key.startsWith("whiteboard/");
      if (!validPrefix) {
        throw Errors.VALIDATION("Invalid r2Key for meeting artifact");
      }

      uploadedById = meeting.hostId;
      registerAsMeetingArtifact = true;
      meetingArtifactType = data.type;
    } else {
      if (data.type !== "pdf") {
        throw Errors.VALIDATION("Only PDF uploads can be registered from the user-facing endpoint");
      }

      const user = await requireAuth();

      const activeSpace = await db.query.spaces.findFirst({
        where: and(eq(spaces.id, data.spaceId), isNull(spaces.archivedAt)),
        columns: { id: true },
      });
      if (!activeSpace) throw Errors.NOT_FOUND("Space");

      await assertSpaceMembership(db, data.spaceId, user.id);

      if (
        !data.r2Key.startsWith(`uploads/${user.id}/`) &&
        !data.r2Key.startsWith(`spaces/${data.spaceId}/`)
      ) {
        throw Errors.VALIDATION("Invalid r2Key for this user");
      }

      uploadedById = user.id;
      const userRow = await db.query.users.findFirst({
        where: eq(users.id, user.id),
        columns: { plan: true },
      });
      userPlan = userRow?.plan ?? "free";
    }

    const r2Object = await env.R2_BUCKET.head(data.r2Key);
    if (!r2Object) throw Errors.NOT_FOUND("Uploaded file not found in storage");
    const actualSize = r2Object.size;

    if (userPlan !== undefined) {
      const limits = getPlanLimits((userPlan as PlanType) ?? "free");
      if (limits.maxStorageBytes !== null) {
        const usage = await getUserStoredBytes(db, uploadedById);
        if (usage + actualSize > limits.maxStorageBytes) {
          try {
            await env.R2_BUCKET.delete(data.r2Key);
            logWarn(
              `[R2] Deleted over-quota upload: ${data.r2Key} (size: ${actualSize} bytes, user: ${uploadedById})`,
            );
          } catch (err: unknown) {
            logWarn(
              `[R2] Failed to delete orphaned over-quota object ${data.r2Key}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          throw Errors.PLAN_LIMIT_REACHED("Storage quota exceeded");
        }
      }
    }

    if (registerAsMeetingArtifact) {
      await registerMeetingArtifactMetadata(db, {
        sessionId: data.sessionId!,
        spaceId: data.spaceId,
        type: meetingArtifactType!,
        r2Key: data.r2Key,
        filename: data.filename,
        mimeType: data.mimeType,
        size: actualSize,
        uploadedById,
        createdAt: new Date(),
      });
    } else {
      await registerSpaceAssetMetadata(db, {
        spaceId: data.spaceId,
        type: "pdf",
        r2Key: data.r2Key,
        filename: data.filename,
        mimeType: data.mimeType,
        size: actualSize,
        uploadedById,
        createdAt: new Date(),
      });
    }

    return { success: true };
  });
