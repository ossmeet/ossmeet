/**
 * React hook for AI whiteboard assistant.
 * Connects to /api/ai/assistant, sends canvas context, streams responses.
 * Broadcasts chat messages to all participants via the whiteboard sync server.
 */

import { useState, useCallback, useRef, useEffect } from "react"
import type { Editor } from "tldraw"
import { WHITEBOARD_EVENTS } from "../../protocol"
import { extractCanvasContext } from "./extract-canvas-context"

// ─── Types ───────────────────────────────────────────────────────────

export interface AssistantMessage {
	id: string
	role: "user" | "assistant"
	content: string
	/** Display name of the user who sent the message */
	userName?: string
	/** Whether this user message included the current whiteboard as context */
	whiteboardAttached?: boolean
}

/** Broadcast message types sent via the whiteboard sync server */
export type AssistantBroadcast =
	| { type: typeof WHITEBOARD_EVENTS.ASSISTANT_PANEL_OPEN }
	| { type: typeof WHITEBOARD_EVENTS.ASSISTANT_PANEL_CLOSE }
	| { type: typeof WHITEBOARD_EVENTS.ASSISTANT_CHAT_USER; message: AssistantMessage }
	| { type: typeof WHITEBOARD_EVENTS.ASSISTANT_CHAT_ASSISTANT; message: AssistantMessage }
	| { type: typeof WHITEBOARD_EVENTS.ASSISTANT_CHAT_STREAMING; requestId: string; streaming: boolean }
	| { type: typeof WHITEBOARD_EVENTS.ASSISTANT_CHAT_CLEAR }

export interface UseWhiteboardAssistantOptions {
	editor: Editor | null
	apiUrl: string
	/** Whiteboard sync server URL (for broadcasting) */
	whiteboardUrl?: string
	/** JWT token for whiteboard auth */
	whiteboardToken?: string
	/** Current user's display name */
	userName?: string
	/** Whether the current user is the host */
	isHost?: boolean
	/** Whether the current user can send messages to the AI assistant */
	canSendAssistantMessage?: boolean
}

export interface SendQuestionOptions {
	includeWhiteboard?: boolean
	userMessageContent?: string
}

const MAX_MESSAGES = 60
const MAX_CHAT_HISTORY = 20
// cap SSE buffer to prevent memory inflation from malicious/buggy streams
const MAX_SSE_BUFFER_BYTES = 512 * 1024 // 512KB

function appendMessageWithCap(
	prev: AssistantMessage[],
	next: AssistantMessage
): AssistantMessage[] {
	const combined = [...prev, next]
	return combined.length > MAX_MESSAGES
		? combined.slice(combined.length - MAX_MESSAGES)
		: combined
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
	if (!value || typeof value !== "object") return false
	const msg = value as Partial<AssistantMessage>
	return (
		typeof msg.id === "string" &&
		(msg.role === "user" || msg.role === "assistant") &&
		typeof msg.content === "string" &&
		(msg.userName === undefined || typeof msg.userName === "string") &&
		(msg.whiteboardAttached === undefined || typeof msg.whiteboardAttached === "boolean")
	)
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useWhiteboardAssistant({
	editor,
	apiUrl,
	whiteboardUrl,
	whiteboardToken,
	userName,
	canSendAssistantMessage = false,
}: UseWhiteboardAssistantOptions) {
	const [messages, setMessages] = useState<AssistantMessage[]>([])
	const [isStreaming, setIsStreaming] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [showPanel, setShowPanel] = useState(false)
	const abortRef = useRef<AbortController | null>(null)
	const activeRequestRef = useRef<string | null>(null)
	// ref-based streaming lock to prevent double-click race (state is stale in same batch)
	const isStreamingRef = useRef(false)
	// ref for messages to avoid stale closure in sendQuestion
	const messagesRef = useRef<AssistantMessage[]>([])
	messagesRef.current = messages

	// ─── Broadcast helper ───────────────────────────────────────────

	const broadcast = useCallback(
		(data: AssistantBroadcast) => {
			if (!whiteboardUrl || !whiteboardToken) return
			const url = new URL("/broadcast", whiteboardUrl)
			fetch(url.toString(), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${whiteboardToken}`,
				},
				body: JSON.stringify({ data }),
			}).catch(() => {
				// Best-effort broadcast
			})
		},
		[whiteboardUrl, whiteboardToken]
	)

	// ─── Handle incoming broadcasts from other participants ─────────

	const handleBroadcast = useCallback((data: unknown) => {
		if (!data || typeof data !== "object") return
		const msg = data as Record<string, unknown>

		switch (msg.type) {
			case WHITEBOARD_EVENTS.ASSISTANT_PANEL_OPEN:
				setShowPanel(true)
				break
			case WHITEBOARD_EVENTS.ASSISTANT_PANEL_CLOSE:
				setShowPanel(false)
				break
			case WHITEBOARD_EVENTS.ASSISTANT_CHAT_USER:
				if (isAssistantMessage(msg.message)) {
					const incoming = msg.message
					setShowPanel(true)
					setMessages((prev) => {
						if (prev.some((m) => m.id === incoming.id)) return prev
						return appendMessageWithCap(prev, incoming)
					})
				}
				break
			case WHITEBOARD_EVENTS.ASSISTANT_CHAT_ASSISTANT:
				if (isAssistantMessage(msg.message)) {
					const incoming = msg.message
					setMessages((prev) => {
						const existing = prev.findIndex((m) => m.id === incoming.id)
						if (existing >= 0) {
							const updated = [...prev]
							updated[existing] = incoming
							return updated
						}
						return appendMessageWithCap(prev, incoming)
					})
				}
				break
			case WHITEBOARD_EVENTS.ASSISTANT_CHAT_STREAMING:
				if (
					typeof msg.requestId === "string" &&
					msg.requestId === activeRequestRef.current
				) {
					setIsStreaming(msg.streaming === true)
				}
				break
			case WHITEBOARD_EVENTS.ASSISTANT_CHAT_CLEAR:
				setMessages([])
				setError(null)
				break
		}
	}, [])

	// ─── Fetch chat history for late joiners ────────────────────────

	const fetchChatHistory = useCallback(async () => {
		if (!whiteboardUrl || !whiteboardToken) return
		try {
			const url = new URL("/ai-chat-history", whiteboardUrl)
			const response = await fetch(url.toString(), {
				headers: { Authorization: `Bearer ${whiteboardToken}` },
			})
			if (!response.ok) return
			const data = await response.json() as { messages?: AssistantMessage[] }
			if (data.messages && data.messages.length > 0) {
				setMessages(data.messages)
			}
		} catch {
			// Best-effort fetch
		}
	}, [whiteboardUrl, whiteboardToken])

	// ─── Toggle panel ──────────────────────────────────────────────

	const openPanel = useCallback(() => {
		setShowPanel(true)
		broadcast({ type: WHITEBOARD_EVENTS.ASSISTANT_PANEL_OPEN })
		// Fetch chat history for late joiners
		void fetchChatHistory()
	}, [broadcast, fetchChatHistory])

	const closePanel = useCallback(() => {
		setShowPanel(false)
		broadcast({ type: WHITEBOARD_EVENTS.ASSISTANT_PANEL_CLOSE })
	}, [broadcast])

	/** Close panel locally only — does not broadcast to other participants */
	const localClosePanel = useCallback(() => {
		setShowPanel(false)
	}, [])

	// ─── Send question ──────────────────────────────────────────────

	const sendQuestion = useCallback(
		async (question: string, options: SendQuestionOptions = {}) => {
			const includeWhiteboard = options.includeWhiteboard !== false
			if (!question.trim()) return
			if (includeWhiteboard && !editor) return
			// use ref-based lock to prevent double-click race
			if (isStreamingRef.current) return
			if (!canSendAssistantMessage) {
				setError("AI assistant is not available.")
				return
			}

			isStreamingRef.current = true
			setError(null)
			setShowPanel(true)
			setIsStreaming(true)
			const requestId = crypto.randomUUID()
			activeRequestRef.current = requestId
			broadcast({
				type: WHITEBOARD_EVENTS.ASSISTANT_CHAT_STREAMING,
				requestId,
				streaming: true,
			})

			// Add user message
			const userMsg: AssistantMessage = {
				id: crypto.randomUUID(),
				role: "user",
				content: options.userMessageContent ?? question,
				userName: userName || "User",
				whiteboardAttached: includeWhiteboard || undefined,
			}
			setMessages((prev) => appendMessageWithCap(prev, userMsg))
			broadcast({ type: WHITEBOARD_EVENTS.ASSISTANT_CHAT_USER, message: userMsg })

			// Extract canvas context only when this message opts into whiteboard context.
			const canvasContext =
				includeWhiteboard && editor ? await extractCanvasContext(editor) : undefined

			// use messagesRef to read current messages without stale closure
			const chatHistory = messagesRef.current.slice(-MAX_CHAT_HISTORY)
				.map((msg) => ({
					role: msg.role,
					content: [msg.whiteboardAttached ? "@Whiteboard" : "", msg.content.trim()]
						.filter(Boolean)
						.join("\n"),
				}))
				.filter((msg) => msg.content)

			// Track assistant response
			const assistantMsgId = crypto.randomUUID()
			let assistantText = ""

			// Add placeholder assistant message
			const placeholderMsg: AssistantMessage = {
				id: assistantMsgId,
				role: "assistant",
				content: "",
			}
			setMessages((prev) => appendMessageWithCap(prev, placeholderMsg))

			const abort = new AbortController()
			abortRef.current = abort

			// Always use explain mode — server sends text chunks
			const mode = "explain"

			try {
				const requestBody = {
					mode,
					question,
					...(canvasContext
						? {
								canvasContext: {
									textContent: canvasContext.textContent,
									shapeCount: canvasContext.shapeCount,
									viewportBounds: canvasContext.viewportBounds,
									visibleShapes: canvasContext.visibleShapes.slice(0, 50),
									selectedShapeIds: canvasContext.selectedShapeIds,
									screenshotDataUrl: canvasContext.screenshotDataUrl,
								},
							}
						: {}),
					chatHistory,
				}

				const response = await fetch(apiUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...(whiteboardToken ? { Authorization: `Bearer ${whiteboardToken}` } : {}),
					},
					body: JSON.stringify(requestBody),
					signal: abort.signal,
				})

				if (!response.ok) {
					const text = await response.text()
					throw new Error(text || `HTTP ${response.status}`)
				}

				const reader = response.body?.getReader()
				if (!reader) throw new Error("No response body")

				const decoder = new TextDecoder()
				let sseBuffer = ""

				while (true) {
					const { done, value } = await reader.read()
					if (done) break

					sseBuffer += decoder.decode(value, { stream: true })

					// cap SSE buffer to prevent OOM from malicious streams
					if (sseBuffer.length > MAX_SSE_BUFFER_BYTES) {
						console.warn("[AI] SSE buffer exceeded limit — aborting stream")
						await reader.cancel()
						break
					}

					// Process complete SSE messages
					const lines = sseBuffer.split("\n")
					sseBuffer = lines.pop() ?? ""

					for (const line of lines) {
						if (!line.startsWith("data: ")) continue
						const data = line.slice(6).trim()

						if (data === "[DONE]") continue

						let parsed: Record<string, unknown>
						try {
							parsed = JSON.parse(data)
						} catch {
							continue
						}

						if (parsed.error) {
							throw new Error(parsed.error as string)
						}

						if ("text" in parsed && typeof parsed.text === "string") {
							assistantText += parsed.text
							setMessages((prev) =>
								prev.map((m) =>
									m.id === assistantMsgId ? { ...m, content: assistantText } : m
								)
							)
							continue
						}
					}
				}

				if (!assistantText) {
					assistantText = "I couldn't generate a response. Please try again."
				}

				setMessages((prev) =>
					prev.map((m) =>
						m.id === assistantMsgId
								? {
										...m,
										content: assistantText,
									}
							: m
					)
				)

				const finalMsg: AssistantMessage = {
					id: assistantMsgId,
					role: "assistant",
					content: assistantText,
				}
				broadcast({ type: WHITEBOARD_EVENTS.ASSISTANT_CHAT_ASSISTANT, message: finalMsg })
			} catch (err: any) {
				if (err.name === "AbortError") return
				console.error("AI assistant error:", err)
				setError(typeof err?.message === "string" ? err.message : "Assistant failed")
				setMessages((prev) =>
					prev.map((m) =>
						m.id === assistantMsgId
							? {
									...m,
									content: `Error: ${typeof err?.message === "string" ? err.message : "Assistant failed"}`,
								}
							: m
					)
				)
			} finally {
				isStreamingRef.current = false
				if (activeRequestRef.current === requestId) {
					setIsStreaming(false)
					activeRequestRef.current = null
				}
				// only null abortRef if it still refers to this request's controller
				if (abortRef.current === abort) {
					abortRef.current = null
				}
				broadcast({
					type: WHITEBOARD_EVENTS.ASSISTANT_CHAT_STREAMING,
					requestId,
					streaming: false,
				})
			}
		},
		[editor, apiUrl, broadcast, userName, canSendAssistantMessage, whiteboardToken]
	)

	// abort SSE stream on unmount to prevent memory leaks
	useEffect(() => {
		return () => {
			abortRef.current?.abort()
		}
	}, [])

	const cancel = useCallback(() => {
		abortRef.current?.abort()
		isStreamingRef.current = false
		setIsStreaming(false)
		activeRequestRef.current = null
	}, [])

	const clearMessages = useCallback(() => {
		abortRef.current?.abort()
		abortRef.current = null
		activeRequestRef.current = null
		isStreamingRef.current = false
		setIsStreaming(false)
		setMessages([])
		setError(null)
		broadcast({ type: WHITEBOARD_EVENTS.ASSISTANT_CHAT_CLEAR })
	}, [broadcast])

	return {
		messages,
		isStreaming,
		error,
		showPanel,
		openPanel,
		closePanel,
		localClosePanel,
		sendQuestion,
		cancel,
		clearMessages,
		handleBroadcast,
	}
}
