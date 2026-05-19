import { BaseTextAdapter, type StructuredOutputOptions, type StructuredOutputResult } from "@tanstack/ai/adapters";
import type { JSONSchema, ModelMessage, StreamChunk, TextOptions } from "@tanstack/ai";

type GeminiProviderOptions = Record<string, unknown>;

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
  error?: {
    message?: string;
  };
}

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

class GeminiFetchTextAdapter extends BaseTextAdapter<
  string,
  GeminiProviderOptions,
  readonly ["text", "image"],
  {
    text: Record<string, never>;
    image: Record<string, never>;
    audio: Record<string, never>;
    video: Record<string, never>;
    document: Record<string, never>;
  },
  readonly []
> {
  readonly name = "gemini-fetch";

  async *chatStream(options: TextOptions<GeminiProviderOptions>): AsyncIterable<StreamChunk> {
    const runId = options.runId ?? crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const startedAt = Date.now();

    yield { type: "RUN_STARTED", threadId: options.threadId, runId, timestamp: startedAt } as StreamChunk;
    yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant", timestamp: startedAt } as StreamChunk;

    const response = await this.fetchGemini("streamGenerateContent", options, {
      stream: true,
    });

    if (!response.body) throw new Error("Gemini stream did not return a response body");

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of response.body) {
      if (options.abortController?.signal.aborted) break;
      buffer += decoder.decode(chunk, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        const parsed = JSON.parse(data) as GeminiResponse;
        if (parsed.error?.message) throw new Error(parsed.error.message);

        const text = extractGeminiText(parsed);
        if (!text) continue;

        yield {
          type: "TEXT_MESSAGE_CONTENT",
          messageId,
          delta: text,
          timestamp: Date.now(),
        } as StreamChunk;
      }
    }

    yield { type: "TEXT_MESSAGE_END", messageId, timestamp: Date.now() } as StreamChunk;
    yield {
      type: "RUN_FINISHED",
      threadId: options.threadId,
      runId,
      timestamp: Date.now(),
    } as StreamChunk;
  }

  async structuredOutput(
    options: StructuredOutputOptions<GeminiProviderOptions>,
  ): Promise<StructuredOutputResult<unknown>> {
    const response = await this.fetchGemini("generateContent", options.chatOptions, {
      outputSchema: options.outputSchema,
    });
    const parsed = await response.json() as GeminiResponse;
    if (parsed.error?.message) throw new Error(parsed.error.message);

    const rawText = extractGeminiText(parsed);
    if (!rawText) throw new Error("Gemini returned an empty structured response");

    return {
      rawText,
      data: JSON.parse(stripJsonCodeFence(rawText)),
    };
  }

  private async fetchGemini(
    action: "generateContent" | "streamGenerateContent",
    options: TextOptions<GeminiProviderOptions>,
    extra: { stream?: boolean; outputSchema?: JSONSchema },
  ): Promise<Response> {
    const apiKey = this.config.apiKey;
    if (!apiKey) throw new Error("Missing Gemini API key");

    const url = new URL(`${GEMINI_API_BASE}/models/${encodeURIComponent(this.model)}:${action}`);
    if (extra.stream) url.searchParams.set("alt", "sse");

    const body = buildGeminiRequestBody(options, extra.outputSchema);
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        ...this.config.headers,
      },
      body: JSON.stringify(body),
      signal: options.abortController?.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Gemini request failed (${response.status}): ${text || response.statusText}`);
    }

    return response;
  }
}

export function createGeminiTextAdapter(model: string, apiKey: string) {
  return new GeminiFetchTextAdapter({ apiKey }, model);
}

function buildGeminiRequestBody(
  options: TextOptions<GeminiProviderOptions>,
  outputSchema?: JSONSchema,
) {
  const generationConfig: Record<string, unknown> = {
    temperature: options.temperature,
    topP: options.topP,
    maxOutputTokens: options.maxTokens,
    ...(options.modelOptions ?? {}),
  };

  if (outputSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiSchema(outputSchema);
  }

  return {
    ...(options.systemPrompts?.length
      ? { systemInstruction: { parts: options.systemPrompts.map((text) => ({ text })) } }
      : {}),
    contents: mergeConsecutiveGeminiContents((options.messages ?? []).map(toGeminiContent)),
    generationConfig: removeUndefined(generationConfig),
  };
}

function toGeminiContent(message: ModelMessage): GeminiContent {
  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: toGeminiParts(message.content),
  };
}

function toGeminiParts(content: ModelMessage["content"]): GeminiPart[] {
  if (typeof content === "string") return [{ text: content }];
  if (!content) return [{ text: "" }];

  return content.flatMap((part): GeminiPart[] => {
    if (part.type === "text") return [{ text: part.content }];
    if (part.type === "image") {
      if (part.source.type !== "data") {
        throw new Error("Gemini fetch adapter only supports inline image data");
      }
      return [{
        inlineData: {
          mimeType: part.source.mimeType,
          data: part.source.value,
        },
      }];
    }
    return [];
  });
}

function mergeConsecutiveGeminiContents(contents: GeminiContent[]): GeminiContent[] {
  const merged: GeminiContent[] = [];
  for (const content of contents) {
    const previous = merged.at(-1);
    if (previous?.role === content.role) {
      previous.parts.push(...content.parts);
    } else {
      merged.push({ role: content.role, parts: [...content.parts] });
    }
  }
  return merged;
}

function extractGeminiText(response: GeminiResponse): string {
  return response.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("") ?? "";
}

function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match?.[1] ?? trimmed;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function toGeminiSchema(schema: JSONSchema): JSONSchema {
  if (Array.isArray(schema)) return schema.map((item) => toGeminiSchema(item as JSONSchema)) as unknown as JSONSchema;
  if (!schema || typeof schema !== "object") return schema;

  const next: JSONSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (
      key === "$schema" ||
      key === "$id" ||
      key === "$defs" ||
      key === "definitions" ||
      key === "additionalProperties"
    ) {
      continue;
    }
    if (key === "type" && Array.isArray(value)) {
      const withoutNull = value.filter((item) => item !== "null");
      next.type = withoutNull.length === 1 ? withoutNull[0] : withoutNull;
      if (withoutNull.length !== value.length) next.nullable = true;
      continue;
    }
    if (Array.isArray(value)) {
      next[key] = value.map((item) => toGeminiSchema(item as JSONSchema));
      continue;
    }
    if (value && typeof value === "object") {
      next[key] = toGeminiSchema(value as JSONSchema);
      continue;
    }
    next[key] = value;
  }
  return next;
}
