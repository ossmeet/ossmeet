import { createFileRoute } from "@tanstack/react-router"
import { streamText } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { z } from "zod"
import { buildAssistantPromptMessages } from "@/lib/ai/assistant-prompt"
import type { AssistantMode } from "@/lib/ai/assistant-prompt"
import { closeAndParseJson } from "@/lib/ai/close-and-parse-json"
import { verifyWhiteboardJWT } from "@/lib/jwt-utils"
import {
	verifySessionFromRawRequest,
	enforceRateLimit,
	getEnvFromRequest,
} from "@/server/auth/helpers"
import { AppError, getPlanLimits } from "@ossmeet/shared"
import type { PlanType } from "@ossmeet/shared"
import { createDb } from "@ossmeet/db"
import { users } from "@ossmeet/db/schema"
import { eq } from "drizzle-orm"
import { logError, logWarn } from "@/lib/logger"

export const Route = createFileRoute("/api/ai/assistant")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				// Schema defined inside the handler — server-only, stripped from client bundle
				const assistantRequestSchema = z.object({
					mode: z.enum(["explain", "assist"]).default("explain"),
					question: z.string().trim().min(1).max(4000),
					canvasContext: z.object({
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
								})
							)
							.max(50)
							.optional(),
						selectedShapeIds: z.array(z.string().min(1).max(256)).max(100).optional(),
						screenshotDataUrl: z
							.string()
							.max(1_500_000)
							.regex(/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/)
							.optional(),
					}),
					chatHistory: z
						.array(
							z.object({
								role: z.enum(["user", "assistant"]),
								content: z.string().max(20_000),
							})
						)
						.max(30)
						.optional(),
				})

				// Get Cloudflare env bindings
				const env = await getEnvFromRequest(request)
				if (!env) {
					return new Response("Server configuration error", { status: 500 })
				}

				// Allow either an authenticated OSSMeet session or a valid whiteboard JWT.
				const session = await verifySessionFromRawRequest(request, env)
				const authHeader = request.headers.get("Authorization")
				const bearerToken =
					authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : null
				let whiteboardSubject: string | null = null
				let whiteboardSid: string | null = null
				if (!session && bearerToken && env.WHITEBOARD_JWT_SECRET) {
					try {
						const claims = await verifyWhiteboardJWT(bearerToken, env.WHITEBOARD_JWT_SECRET)
						// All JWT roles (host/participant/guest) get free-tier AI access.
						whiteboardSubject = claims.sub
						whiteboardSid = claims.sid
					} catch {
						// fall through to unauthorized
					}
				}
				if (!session && !whiteboardSubject) {
					return new Response("Unauthorized", { status: 401 })
				}

				// rate-limit by user id (session) or by participant id per meeting (JWT)
				// Using the meeting session id (sid) prevents guests from rotating participantIds
				// to get a fresh rate-limit bucket.
				const rateLimitKey = session
					? `ai:assistant:${session.userId}`
					: `ai:assistant:${whiteboardSid}:${whiteboardSubject}`
				try {
					await enforceRateLimit(env, rateLimitKey, true)
				} catch (error) {
					if (error instanceof AppError && error.code === "RATE_LIMITED") {
						return new Response(error.message, { status: error.statusCode })
					}
					throw error
				}

				// C3: Look up plan from DB for JWT-authenticated non-guest users too
				let plan: PlanType = "free"
				if (session) {
					const db = createDb(env.DB)
					const userRow = await db.query.users.findFirst({
						where: eq(users.id, session.userId),
						columns: { plan: true },
					})
					plan = (userRow?.plan ?? "free") as PlanType
				} else if (whiteboardSubject) {
					// JWT sub is a LiveKit identity, not a users.id — use free-tier limits.
					plan = "free"
				}
				const planLimits = getPlanLimits(plan)
				if (!planLimits.aiAssistantEnabled) {
					return new Response("AI assistant is not available on your current plan", { status: 403 })
				}

				// Check AI is configured
				if (!env.AI_API_KEY || !env.AI_MODEL) {
					logError("[AI Assistant] Missing AI_API_KEY or AI_MODEL")
					return new Response("AI not configured", { status: 503 })
				}

				let rawBody: unknown
				try {
					rawBody = await request.json()
				} catch {
					return new Response("Invalid JSON", { status: 400 })
				}

				const parsed = assistantRequestSchema.safeParse(rawBody)
				if (!parsed.success) {
					return new Response("Invalid request body", { status: 400 })
				}
				const body = parsed.data

				const mode = body.mode as AssistantMode
				const modelIds = [env.AI_MODEL, env.AI_MODEL_FALLBACK].filter(Boolean) as string[]
				const google = createGoogleGenerativeAI({
					apiKey: env.AI_API_KEY,
				})

				const messages = buildAssistantPromptMessages({
					question: body.question,
					canvasContext: body.canvasContext,
					chatHistory: body.chatHistory ?? [],
					mode,
				})
				if (messages.length === 0) {
					return new Response("Missing question", { status: 400 })
				}

				const encoder = new TextEncoder()
				const { readable, writable } = new TransformStream()
				const writer = writable.getWriter()
				const abortController = new AbortController()
				const abortIfClientDisconnects = () => abortController.abort()
				request.signal.addEventListener("abort", abortIfClientDisconnects)

				;(async () => {
					let hasWritten = false
					const tryStream = async (modelId: string) => {
						const result = streamText({
							model: google(modelId),
							messages,
							temperature: 0.2,
							maxOutputTokens: mode === "assist" ? 8192 : 4096,
							abortSignal: abortController.signal,
						})

						if (mode === "explain") {
							// ─── Explain mode: stream text chunks ─────────
							// Buffer to strip <thought>...</thought> tags that
							// arrive across multiple chunks (e.g. Gemma 4).
							let buffer = ""
							let insideThought = false
							for await (const text of result.textStream) {
								if (!text) continue
								buffer += text
								// Detect entering a thought block
								if (!insideThought && buffer.includes("<thought>")) {
									insideThought = true
								}
								// Wait until the closing tag arrives
								if (insideThought) {
									if (!buffer.includes("</thought>")) continue
									buffer = stripThinkingTags(buffer)
									insideThought = false
								}
								if (!buffer) continue
								const sseData = `data: ${JSON.stringify({ text: buffer })}\n\n`
								await writer.write(encoder.encode(sseData))
								hasWritten = true
								await writer.ready
								buffer = ""
							}
							// Flush any remaining buffered text
							if (buffer) {
								buffer = stripThinkingTags(buffer)
								if (buffer) {
									const sseData = `data: ${JSON.stringify({ text: buffer })}\n\n`
									await writer.write(encoder.encode(sseData))
									hasWritten = true
									await writer.ready
								}
							}
						} else {
							// ─── Assist mode: parse streaming JSON actions ──────
							// The model is instructed to return {"actions": [...]}
							// We accumulate the full response, then parse actions from it.
							let fullText = ""

							for await (const text of result.textStream) {
								if (!text) continue
								fullText += text

								// Try to extract actions from partial JSON
								const partialObject = closeAndParseJson(fullText)
								if (!partialObject) continue

								// The model might return the JSON directly or wrapped in markdown
								const actions = partialObject.actions
								if (!Array.isArray(actions)) continue

								// Emit all actions we haven't emitted yet as incomplete
								for (const action of actions) {
									const a = action as Record<string, unknown>
									if (a && a._type) {
										const sseData = `data: ${JSON.stringify({
											type: "action",
											action: { ...a, complete: false },
										})}\n\n`
										await writer.write(encoder.encode(sseData))
										hasWritten = true
										await writer.ready
									}
								}
							}

							// Final parse — emit all actions as complete
							fullText = stripThinkingTags(fullText)
							const finalParsed = extractActionsFromResponse(fullText)
							if (finalParsed) {
								for (const action of finalParsed) {
									const a = action as Record<string, unknown>
									if (a && a._type) {
										const sseData = `data: ${JSON.stringify({
											type: "action",
											action: { ...a, complete: true },
										})}\n\n`
										await writer.write(encoder.encode(sseData))
										hasWritten = true
										await writer.ready
									}
								}
							} else {
								// Model didn't return valid JSON — treat full response as text
								logWarn("[AI Assistant] Could not parse actions from response, falling back to text")
								if (fullText.trim()) {
									const sseData = `data: ${JSON.stringify({ text: fullText.trim() })}\n\n`
									await writer.write(encoder.encode(sseData))
									hasWritten = true
									await writer.ready
								}
							}
						}
					}

					try {
						for (const modelId of modelIds) {
							try {
								await tryStream(modelId)
								break
							} catch (err: any) {
								if (abortController.signal.aborted || hasWritten) throw err
								logError(`[AI Assistant] model ${modelId} failed, trying fallback:`, err?.message || err)
							}
						}
						await writer.write(encoder.encode("data: [DONE]\n\n"))
						await writer.close()
					} catch (error: any) {
						if (abortController.signal.aborted) {
							try {
								await writer.close()
							} catch {
								// stream already closed
							}
							return
						}
						logError("[AI Assistant] Stream error:", error?.message || error)
						const errorData = `data: ${JSON.stringify({ error: "Assistant stream failed" })}\n\n`
						try {
							await writer.write(encoder.encode(errorData))
							await writer.close()
						} catch {
							await writer.abort(error)
						}
					} finally {
						request.signal.removeEventListener(
							"abort",
							abortIfClientDisconnects
						)
					}
				})()

				return new Response(readable, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache, no-transform",
						Connection: "keep-alive",
						"X-Accel-Buffering": "no",
					},
				})
			},
		},
	},
})

/**
 * Strip model thinking tags (e.g. Gemma 4's <thought>...</thought>)
 * from streamed text so downstream parsing sees clean content.
 */
function stripThinkingTags(text: string): string {
	return text.replace(/<thought>[\s\S]*?<\/thought>/g, "").trimStart()
}

/**
 * Extract actions array from model response text.
 * Handles: raw JSON, markdown-wrapped JSON (```json ... ```), or partial JSON.
 */
function extractActionsFromResponse(text: string): unknown[] | null {
	// Try direct parse first
	try {
		const obj = JSON.parse(text)
		if (obj && Array.isArray(obj.actions)) return obj.actions
	} catch {
		// not valid JSON
	}

	// Try extracting from markdown code block
	const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
	if (codeBlockMatch) {
		try {
			const obj = JSON.parse(codeBlockMatch[1])
			if (obj && Array.isArray(obj.actions)) return obj.actions
		} catch {
			// not valid JSON in code block
		}
	}

	// Try closeAndParseJson as fallback for partial JSON
	const partial = closeAndParseJson(text)
	if (partial && Array.isArray(partial.actions)) return partial.actions

	// Try finding JSON object in the text
	const jsonMatch = text.match(/\{[\s\S]*"actions"\s*:\s*\[[\s\S]*\][\s\S]*\}/)
	if (jsonMatch) {
		try {
			const obj = JSON.parse(jsonMatch[0])
			if (obj && Array.isArray(obj.actions)) return obj.actions
		} catch {
			const partial2 = closeAndParseJson(jsonMatch[0])
			if (partial2 && Array.isArray(partial2.actions)) return partial2.actions
		}
	}

	return null
}
