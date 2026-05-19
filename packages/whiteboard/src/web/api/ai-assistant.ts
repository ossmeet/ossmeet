import { chat } from "@tanstack/ai";
import { z } from "zod";
import { buildAssistantPromptMessages } from "@/lib/ai/assistant-prompt";
import { createGeminiTextAdapter } from "@/server/ai/gemini";
import { enforceRateLimit } from "@/server/auth/helpers";
import { AppError, getPlanLimits } from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { createDb } from "@ossmeet/db";
import { transcripts, users } from "@ossmeet/db/schema";
import { desc, eq } from "drizzle-orm";
import { logError } from "@/lib/logger";
import { RequestBodyTooLargeError, readRequestBodyBytes } from "@/server/request-body";
import { verifyActiveWhiteboardBearer } from "./active-whiteboard-auth";

const MAX_ASSISTANT_BODY_BYTES = 2 * 1024 * 1024;
const RECENT_TRANSCRIPT_LIMIT = 80;
const RECENT_TRANSCRIPT_CONTEXT_MAX_CHARS = 12_000;

const assistantRequestSchema = z.object({
  mode: z.literal("explain").default("explain"),
  question: z.string().trim().min(1).max(4000),
  canvasContext: z
    .object({
      textContent: z.string().max(120_000),
      shapeCount: z.number().int().min(0).max(10_000),
      viewportBounds: z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        w: z.number().positive(),
        h: z.number().positive(),
      }),
      visibleShapes: z
        .array(
          z.object({
            id: z.string().min(1).max(256),
            type: z.string().min(1).max(64),
            text: z.string().max(10_000).optional(),
            bounds: z.object({
              x: z.number().finite(),
              y: z.number().finite(),
              w: z.number().nonnegative(),
              h: z.number().nonnegative(),
            }),
          }),
        )
        .max(50)
        .optional(),
      selectedShapeIds: z.array(z.string().min(1).max(256)).max(100).optional(),
      screenshotDataUrl: z
        .string()
        .max(1_500_000)
        .regex(/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/)
        .optional(),
    })
    .optional(),
  chatHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(20_000),
      }),
    )
    .max(30)
    .optional(),
});

export async function handleAssistant(request: Request, env: Env): Promise<Response> {
  const db = createDb(env.DB);
  const auth = await verifyActiveWhiteboardBearer(request, env, db);
  if (auth instanceof Response) return auth;

  const rateLimitKey = auth.access.userId
    ? `ai:assistant:${auth.access.userId}`
    : `ai:assistant:guest:${auth.access.admissionId ?? auth.access.connectionId}`;
  try {
    await enforceRateLimit(env, rateLimitKey, true);
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMITED") {
      return new Response(error.message, { status: error.statusCode });
    }
    throw error;
  }

  let plan: PlanType = "free";
  if (auth.access.userId) {
    const userRow = await db.query.users.findFirst({
      where: eq(users.id, auth.access.userId),
      columns: { plan: true },
    });
    plan = (userRow?.plan ?? "free") as PlanType;
  }
  const planLimits = getPlanLimits(plan);
  if (!planLimits.aiAssistantEnabled) {
    return new Response("AI assistant is not available on your current plan", { status: 403 });
  }

  if (!env.AI_API_KEY || !env.AI_MODEL) {
    logError("[AI Assistant] Missing AI_API_KEY or AI_MODEL");
    return new Response("AI not configured", { status: 503 });
  }

  let rawBody: unknown;
  try {
    const bodyBytes = await readRequestBodyBytes(request, MAX_ASSISTANT_BODY_BYTES);
    rawBody = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new Response("Payload too large", { status: 413 });
    }
    return new Response("Invalid JSON", { status: 400 });
  }

  const parsed = assistantRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return new Response("Invalid request body", { status: 400 });
  }
  const body = parsed.data;

  const mode = body.mode;
  const modelIds = [env.AI_MODEL, env.AI_MODEL_FALLBACK].filter(Boolean) as string[];
  const recentTranscriptText = await getRecentTranscriptContext(db, auth.meetingId);
  const prompt = buildAssistantPromptMessages({
    question: body.question,
    canvasContext: body.canvasContext,
    chatHistory: body.chatHistory ?? [],
    meetingContext: { recentTranscriptText },
    mode,
  });
  if (prompt.messages.length === 0) {
    return new Response("Missing question", { status: 400 });
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const abortController = new AbortController();
  const abortIfClientDisconnects = () => abortController.abort();
  request.signal.addEventListener("abort", abortIfClientDisconnects);

  (async () => {
    let hasWritten = false;
    let streamSucceeded = false;
    const tryStream = async (modelId: string) => {
      const stream = chat({
        adapter: createGeminiTextAdapter(modelId, env.AI_API_KEY!),
        systemPrompts: prompt.systemPrompts,
        messages: prompt.messages,
        temperature: 0.2,
        maxTokens: 4096,
        abortController,
      });

      let buffer = "";
      let insideThought = false;
      // Track potential partial opening tag at buffer tail to prevent
      // split-across-chunks leaks (e.g. "<tho" + "ught>reasoning</thought>").
      let mayHavePartialOpenTag = false;
      const OPEN_TAG = "<thought>";
      const CLOSE_TAG = "</thought>";

      for await (const chunk of stream) {
        if (chunk.type === "RUN_ERROR") {
          throw new Error(
            typeof chunk.error === "string"
              ? chunk.error
              : chunk.error?.message ?? "Assistant stream failed",
          );
        }
        if (chunk.type !== "TEXT_MESSAGE_CONTENT" || !chunk.delta) continue;
        const text = chunk.delta;
        if (!text) continue;
        buffer += text;

        if (!insideThought) {
          // If the previous chunk ended mid-tag, wait for more data.
          if (mayHavePartialOpenTag && buffer.length < OPEN_TAG.length) continue;
          mayHavePartialOpenTag = false;

          if (buffer.includes(OPEN_TAG)) {
            insideThought = true;
          } else {
            // Check if the buffer tail could be the start of a partial tag.
            // Retain the ambiguous tail so it can't leak as visible text.
            let safeEnd = buffer.length;
            for (let len = 1; len < OPEN_TAG.length && len < buffer.length; len++) {
              if (OPEN_TAG.startsWith(buffer.slice(-len))) {
                safeEnd = buffer.length - len;
                mayHavePartialOpenTag = true;
                break;
              }
            }
            if (safeEnd > 0) {
              const toFlush = buffer.slice(0, safeEnd);
              buffer = buffer.slice(safeEnd);
              const sseData = `data: ${JSON.stringify({ text: toFlush })}\n\n`;
              await writer.write(encoder.encode(sseData));
              hasWritten = true;
              await writer.ready;
            }
            continue;
          }
        }

        if (insideThought) {
          if (!buffer.includes(CLOSE_TAG)) continue;
          buffer = stripThinkingTags(buffer);
          insideThought = false;
        }
        if (!buffer) continue;
        const sseData = `data: ${JSON.stringify({ text: buffer })}\n\n`;
        await writer.write(encoder.encode(sseData));
        hasWritten = true;
        await writer.ready;
        buffer = "";
      }
      if (buffer) {
        if (insideThought) {
          buffer = stripThinkingTags(buffer);
        } else {
          // Flush the remaining partial-tag tail as-is; it's not a real tag.
          mayHavePartialOpenTag = false;
        }
        if (buffer) {
          const sseData = `data: ${JSON.stringify({ text: buffer })}\n\n`;
          await writer.write(encoder.encode(sseData));
          hasWritten = true;
          await writer.ready;
        }
      }
      streamSucceeded = true;
    };

    try {
      for (const modelId of modelIds) {
        try {
          await tryStream(modelId);
          break;
        } catch (err: any) {
          if (abortController.signal.aborted || hasWritten) throw err;
          logError(`[AI Assistant] model ${modelId} failed, trying fallback:`, err?.message || err);
        }
      }
      if (!streamSucceeded && !hasWritten) {
        throw new Error("No assistant model produced output");
      }
      await writer.write(encoder.encode("data: [DONE]\n\n"));
      await writer.close();
    } catch (error: any) {
      if (abortController.signal.aborted) {
        try {
          await writer.close();
        } catch {
          // stream already closed
        }
        return;
      }
      logError("[AI Assistant] Stream error:", error?.message || error);
      const errorData = `data: ${JSON.stringify({ error: "Assistant stream failed" })}\n\n`;
      try {
        await writer.write(encoder.encode(errorData));
        await writer.close();
      } catch {
        await writer.abort(error);
      }
    } finally {
      request.signal.removeEventListener("abort", abortIfClientDisconnects);
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function getRecentTranscriptContext(
  db: import("@ossmeet/db").Database,
  meetingId: string,
): Promise<string | undefined> {
  const rows = await db
    .select({
      participantName: transcripts.participantName,
      text: transcripts.text,
      startedAt: transcripts.startedAt,
    })
    .from(transcripts)
    .where(eq(transcripts.sessionId, meetingId))
    .orderBy(desc(transcripts.startedAt))
    .limit(RECENT_TRANSCRIPT_LIMIT)
    .all();

  if (rows.length === 0) return undefined;

  const text = rows
    .reverse()
    .map((row) => {
      const content = row.text.trim();
      if (!content) return "";
      return `[${formatTranscriptTime(row.startedAt)} ${row.participantName}]: ${content}`;
    })
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) return undefined;
  if (text.length <= RECENT_TRANSCRIPT_CONTEXT_MAX_CHARS) return text;
  return text.slice(text.length - RECENT_TRANSCRIPT_CONTEXT_MAX_CHARS).trimStart();
}

function formatTranscriptTime(value: Date): string {
  const hours = String(value.getUTCHours()).padStart(2, "0");
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  const seconds = String(value.getUTCSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function stripThinkingTags(text: string): string {
  return text.replace(/<thought>[\s\S]*?<\/thought>/g, "").trimStart();
}
