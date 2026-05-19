/**
 * Whiteboard Assistant Panel — compact, draggable AI chat window.
 */

import { lazy, Suspense, useState, useRef, useEffect, useCallback } from "react"
import { Sparkles, Send, X, Square, Trash2, GripHorizontal, Image } from "lucide-react"
import type { AssistantMessage, SendQuestionOptions } from "../lib/ai/use-whiteboard-assistant"
import { cn } from "../lib/utils"
import type { Components } from "react-markdown"
import type { Editor } from "tldraw"
import type { AssistantMarkdownRendererProps } from "./whiteboard-assistant-markdown.client"

const MarkdownRenderer = import.meta.env.SSR
	? null
	: lazy(async () => {
		const module = await import("./whiteboard-assistant-markdown.client")
		return {
			default: module.AssistantMarkdownRenderer,
		}
	})

export interface WhiteboardAssistantProps {
	editor?: Editor | null
	open: boolean
	onClose: () => void
	messages: AssistantMessage[]
	isStreaming: boolean
	error: string | null
	sendQuestion: (question: string, options?: SendQuestionOptions) => void
	cancel: () => void
	clearMessages: () => void
	/** Whether the current user can send messages to the AI assistant */
	canSendAssistantMessage?: boolean
	/** Whether the current user can clear the shared assistant conversation */
	canClearMessages?: boolean
	isPhone?: boolean
}

const DEFAULT_WHITEBOARD_QUESTION = "Review the current whiteboard."

export function WhiteboardAssistant({
	editor,
	open,
	onClose,
	messages,
	isStreaming,
	error,
	sendQuestion,
	cancel,
	clearMessages,
	canSendAssistantMessage = false,
	canClearMessages = false,
	isPhone = false,
}: WhiteboardAssistantProps) {
	const [input, setInput] = useState("")
	const [includeWhiteboard, setIncludeWhiteboard] = useState(true)
	const [isDarkMode, setIsDarkMode] = useState(false)
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLTextAreaElement>(null)

	// ─── Drag logic ───────────────────────────────────────────────────
	const panelRef = useRef<HTMLDivElement>(null)
	// null = not yet dragged (uses CSS default position); non-null = absolute pixel position
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
	const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

	const onDragStart = useCallback((e: React.PointerEvent) => {
		e.preventDefault()
		const el = panelRef.current
		if (!el) return
		// Use actual rendered position as origin so the panel doesn't jump on first drag
		const rect = el.getBoundingClientRect()
		const origX = position?.x ?? rect.left
		const origY = position?.y ?? rect.top
		dragState.current = {
			startX: e.clientX,
			startY: e.clientY,
			origX,
			origY,
		}
		el.setPointerCapture(e.pointerId)
	}, [position])

	const onDragMove = useCallback((e: React.PointerEvent) => {
		if (!dragState.current) return
		const dx = e.clientX - dragState.current.startX
		const dy = e.clientY - dragState.current.startY
		setPosition({
			x: dragState.current.origX + dx,
			y: dragState.current.origY + dy,
		})
	}, [])

	const onDragEnd = useCallback(() => {
		dragState.current = null
	}, [])

	// Auto-scroll to bottom on new messages
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [messages])

	// Focus input when panel opens
	useEffect(() => {
		if (!open || !canSendAssistantMessage) return
		const timer = window.setTimeout(() => inputRef.current?.focus(), 100)
		return () => window.clearTimeout(timer)
	}, [canSendAssistantMessage, open])

	useEffect(() => {
		if (typeof window === "undefined") return
		const root = window.document.documentElement
		const update = () => {
			setIsDarkMode(root.classList.contains("dark") || !!editor?.user.getIsDarkMode())
		}
		update()
		const observer = new MutationObserver(update)
		observer.observe(root, { attributes: true, attributeFilter: ["class"] })
		const unsubscribe = editor
			? editor.store.listen(update, { scope: "session" })
			: undefined
		return () => {
			observer.disconnect()
			unsubscribe?.()
		}
	}, [editor])

	useEffect(() => {
		const textarea = inputRef.current
		if (!textarea) return
		textarea.style.height = "auto"
		const nextHeight = Math.min(textarea.scrollHeight, 80)
		textarea.style.height = `${Math.max(32, nextHeight)}px`
		textarea.style.overflowY = textarea.scrollHeight > 80 ? "auto" : "hidden"
	}, [input])

	const handleSubmit = useCallback(
		(e?: React.FormEvent) => {
			e?.preventDefault()
			const question = input.trim()
			if (!canSendAssistantMessage || isStreaming || (!question && !includeWhiteboard)) return
			sendQuestion(question || DEFAULT_WHITEBOARD_QUESTION, {
				includeWhiteboard,
				userMessageContent: question,
			})
			setInput("")
		},
		[canSendAssistantMessage, includeWhiteboard, input, isStreaming, sendQuestion]
	)

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				handleSubmit()
			}
		},
		[handleSubmit]
	)

	if (!open) return null

	const markdownComponents: Components = {
		p: ({ children }) => <p className="my-0.5 last:mb-0">{children}</p>,
		ul: ({ children }) => <ul className="my-0.5 pl-3 list-disc">{children}</ul>,
		ol: ({ children }) => <ol className="my-0.5 pl-3 list-decimal">{children}</ol>,
		li: ({ children }) => <li className="my-0">{children}</li>,
		pre: ({ children }) => (
			<pre
				className={cn(
					"my-1 rounded p-1.5 text-[11px] overflow-x-auto",
					isDarkMode ? "bg-stone-800 text-stone-100" : "bg-gray-200 text-gray-900"
				)}
			>
				{children}
			</pre>
		),
		code: ({ className, children, node, ...props }) => {
			const isInlineCode =
				!!node && node.position?.start.line === node.position?.end.line
			if (isInlineCode) {
				return (
					<code
						className={cn(
							"px-0.5 py-px rounded text-[11px]",
							isDarkMode
								? "bg-stone-800 text-stone-100"
								: "bg-gray-200 text-gray-900"
						)}
						{...props}
					>
						{children}
					</code>
				)
			}
			return (
				<code className={className} {...props}>
					{children}
				</code>
			)
		},
		strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
	}

	const visibleMessages = messages

	return (
		<div
			ref={panelRef}
			className={cn(
				"absolute z-[300]",
				"flex flex-col",
				isDarkMode
					? "bg-stone-900 border border-stone-700 text-stone-100"
					: "bg-white border border-gray-200 text-gray-900",
				"rounded-lg shadow-lg",
				"select-none",
				"overflow-hidden"
			)}
			style={
				isPhone
					? { left: "4px", right: "4px", top: "60px", bottom: "calc(env(safe-area-inset-bottom, 0px) + 10rem)", maxHeight: "none", width: "auto" }
					: position !== null
						? { left: `${position.x}px`, top: `${position.y}px`, width: "400px", height: "500px", maxWidth: "90vw", maxHeight: "80vh" }
						: { right: "16px", top: "72px", width: "400px", height: "500px", maxWidth: "90vw", maxHeight: "80vh" }
			}
			onPointerDown={(e) => e.stopPropagation()}
			onWheel={(e) => e.stopPropagation()}
			onPointerMove={isPhone ? undefined : onDragMove}
			onPointerUp={isPhone ? undefined : onDragEnd}
		>
			{/* Header — draggable on desktop */}
			<div
				className={cn(
					"flex items-center justify-between px-3 py-3 rounded-t-lg",
					!isPhone && "cursor-grab active:cursor-grabbing",
					isDarkMode ? "border-b border-stone-700" : "border-b border-gray-100"
				)}
				onPointerDown={isPhone ? undefined : onDragStart}
			>
				<div className="flex items-center gap-1.5">
					{!isPhone && <GripHorizontal className={cn("w-3 h-3", isDarkMode ? "text-stone-500" : "text-gray-400")} />}
					<Sparkles className={cn("w-3 h-3 text-violet-500", isStreaming && "animate-pulse")} />
					<span className={cn("text-xs font-medium", isDarkMode && "text-stone-200")}>
						AI Assistant
					</span>
					{isStreaming && (
						<span className="text-[10px] text-violet-500/80 italic ml-1 animate-pulse">
							thinking...
						</span>
					)}
				</div>
				<div
					className="flex items-center gap-0.5"
					onPointerDown={(e) => e.stopPropagation()}
				>
					<button
						onClick={onClose}
						className={cn(
							"p-1 rounded cursor-pointer",
							isDarkMode
								? "text-stone-400 hover:text-stone-200 hover:bg-stone-800"
								: "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
						)}
					>
						<X className="w-3 h-3 pointer-events-none" />
					</button>
				</div>
			</div>

			{/* Messages */}
			<div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-2 space-y-2 min-h-0">
				{visibleMessages.length === 0 && !isStreaming && (
					<div
						className={cn(
							"flex flex-col items-center justify-center py-8 text-xs gap-2",
							isDarkMode ? "text-stone-500" : "text-gray-400"
						)}
					>
						<Sparkles className="w-5 h-5 text-violet-400" />
					</div>
				)}
				{visibleMessages.map((msg) => (
					<MessageBubble
						key={msg.id}
						message={msg}
						isDarkMode={isDarkMode}
						markdownComponents={markdownComponents}
					/>
				))}
				{isStreaming && visibleMessages.length > 0 && visibleMessages[visibleMessages.length - 1]?.role !== "assistant" && (
					<div
						className={cn(
							"flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg w-fit",
							isDarkMode ? "bg-stone-800 text-stone-300" : "bg-gray-50 text-gray-500"
						)}
					>
						<span className="flex gap-1 py-1 px-1">
							<span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:0ms]" />
							<span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:150ms]" />
							<span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:300ms]" />
						</span>
						<span className="text-[11px] font-medium animate-pulse">Thinking...</span>
					</div>
				)}
				{error && (
					<div
						className={cn(
							"text-[11px] rounded px-2 py-1",
							isDarkMode
								? "text-red-300 bg-red-900/40"
								: "text-red-500 bg-red-50"
						)}
					>
						{error}
					</div>
				)}
				<div ref={messagesEndRef} />
			</div>

			{/* Input or read-only notice */}
			{canSendAssistantMessage ? (
				<form
					onSubmit={handleSubmit}
					className={cn(
						"px-2 py-1.5 rounded-b-lg space-y-1.5",
						isDarkMode ? "border-t border-stone-700" : "border-t border-gray-100"
					)}
				>
					<div className="flex items-center justify-between gap-2">
						{includeWhiteboard ? (
							<button
								type="button"
								onClick={() => setIncludeWhiteboard(false)}
								disabled={isStreaming}
								className={cn(
									"inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium",
									isDarkMode
										? "border-violet-400/30 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25"
										: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
									isStreaming && "opacity-60"
								)}
									title="Remove whiteboard from this message"
								>
									<Image className="w-3 h-3" />
									<span>Whiteboard attached</span>
									<X className="w-3 h-3" />
								</button>
						) : (
							<button
								type="button"
								onClick={() => setIncludeWhiteboard(true)}
								disabled={isStreaming}
								className={cn(
									"inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium",
									isDarkMode
										? "border-stone-700 text-stone-300 hover:bg-stone-800"
										: "border-gray-200 text-gray-600 hover:bg-gray-50",
									isStreaming && "opacity-60"
								)}
									title="Attach the current whiteboard"
								>
									<Image className="w-3 h-3" />
								<span>Attach whiteboard</span>
							</button>
						)}
						{canClearMessages && messages.length > 0 && (
							<button
								type="button"
								onClick={clearMessages}
								className={cn(
									"inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px]",
									isDarkMode
										? "text-stone-500 hover:text-stone-200 hover:bg-stone-800"
										: "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
								)}
								title="Clear conversation"
							>
								<Trash2 className="w-3 h-3" />
								<span>Clear</span>
							</button>
						)}
					</div>
					<div className="flex items-end gap-1.5">
						<textarea
							ref={inputRef}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
								placeholder={includeWhiteboard ? "Ask about this whiteboard..." : "Ask anything..."}
							rows={1}
							className={cn(
								"flex-1 resize-none rounded border px-2 py-1.5",
								isDarkMode
									? "border-stone-700 bg-stone-800 text-stone-100 placeholder-stone-500"
									: "border-gray-200 bg-white text-gray-900 placeholder-gray-400",
								"text-xs",
								"focus:outline-hidden focus:ring-1 focus:ring-violet-500 focus:border-transparent",
								"max-h-[80px]"
							)}
							disabled={isStreaming}
						/>
						{isStreaming ? (
							<button
								type="button"
								onClick={cancel}
								className={cn(
									"p-1.5 rounded",
									isDarkMode
										? "text-stone-400 hover:text-red-400"
										: "text-gray-500 hover:text-red-500"
								)}
								title="Stop"
							>
								<Square className="w-3 h-3" />
							</button>
						) : (
							<button
								type="submit"
								disabled={!input.trim() && !includeWhiteboard}
								className={cn(
									"p-1.5 rounded",
									input.trim() || includeWhiteboard
										? "text-white bg-violet-600 hover:bg-violet-700"
										: isDarkMode
											? "text-stone-600 bg-stone-800"
											: "text-gray-300 bg-gray-100"
								)}
							>
								<Send className="w-3 h-3" />
							</button>
						)}
					</div>
				</form>
			) : (
				<div
					className={cn(
						"px-3 py-2.5 text-center text-[11px] rounded-b-lg",
						isDarkMode
							? "border-t border-stone-700 text-stone-500"
							: "border-t border-gray-100 text-gray-400"
					)}
				>
					AI assistant is unavailable.
				</div>
			)}
		</div>
	)
}

// ─── Message bubble ──────────────────────────────────────────────────

function MessageBubble({
	message,
	isDarkMode,
	markdownComponents,
}: {
	message: AssistantMessage
	isDarkMode: boolean
	markdownComponents: Components
}) {
	const isUser = message.role === "user"
	const isGenerating = message.role === "assistant" && message.content === ""

	return (
		<div className={cn("flex min-w-0 pb-1.5", isUser ? "justify-end pl-6" : "justify-start pr-6")}>
			<div
				className={cn(
					"min-w-0 rounded-lg px-3 py-2 text-[13px] leading-relaxed shadow-sm",
					isUser
						? "bg-violet-600 text-white rounded-tr-sm"
						: isDarkMode
							? "bg-stone-800 text-stone-100 rounded-tl-sm border border-stone-700/50"
							: "bg-white text-gray-800 rounded-tl-sm border border-gray-100"
				)}
			>
				{message.content || message.whiteboardAttached ? (
					<div className="space-y-1.5">
						{isUser && message.userName && (
							<div className="text-[11px] font-semibold leading-none text-white/80">
								{message.userName}
							</div>
						)}
						{isUser && message.whiteboardAttached && (
							<div className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white">
								<Image className="w-3 h-3" />
								<span>Whiteboard attached</span>
							</div>
						)}
						{message.content && (
							<div className={cn(
								"prose prose-sm max-w-none min-w-0 break-words",
								"prose-pre:max-w-full prose-pre:overflow-x-auto",
								"prose-p:leading-relaxed prose-p:my-1.5 first:prose-p:mt-0 last:prose-p:mb-0",
								isDarkMode ? "prose-invert" : ""
							)}>
								{isUser ? (
									<p className="whitespace-pre-wrap break-words m-0 text-[13px]">
										{message.content}
									</p>
								) : (
									<AssistantMarkdown
										content={message.content}
										components={markdownComponents}
									/>
								)}
							</div>
						)}
					</div>
				) : isGenerating ? (
					<div className="flex items-center h-4">
						<span className="w-1.5 h-4 bg-violet-400 animate-pulse rounded-[1px]" />
					</div>
				) : null}
			</div>
		</div>
	)
}

function AssistantMarkdown({ content, components }: AssistantMarkdownRendererProps) {
	if (!MarkdownRenderer) {
		return <p className="whitespace-pre-wrap break-words m-0 text-[13px]">{content}</p>
	}

	return (
		<Suspense fallback={<p className="whitespace-pre-wrap break-words m-0 text-[13px]">{content}</p>}>
			<MarkdownRenderer content={content} components={components} />
		</Suspense>
	)
}
