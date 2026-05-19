import type { ContentPart, ModelMessage } from "@tanstack/ai"

export type AssistantMode = "explain"

export interface AssistantChatMessage {
	role: "user" | "assistant"
	content: string
}

export interface AssistantShapeSummary {
	id: string
	type: string
	text?: string
	bounds: { x: number; y: number; w: number; h: number }
}

export interface AssistantCanvasContext {
	textContent: string
	shapeCount: number
	viewportBounds: { x: number; y: number; w: number; h: number }
	selectedShapeIds?: string[]
	visibleShapes?: AssistantShapeSummary[]
	screenshotDataUrl?: string
}

export interface AssistantMeetingContext {
	recentTranscriptText?: string
}

export interface AssistantRequestInput {
	question: string
	canvasContext?: AssistantCanvasContext
	chatHistory: AssistantChatMessage[]
	meetingContext?: AssistantMeetingContext
	mode: AssistantMode
}

export interface AssistantPromptMessages {
	systemPrompts: string[]
	messages: ModelMessage[]
}

// ─── System prompts ─────────────────────────────────────────────────

const SYSTEM_PROMPT_EXPLAIN = `You are an expert AI collaborator helping users on a shared whiteboard during a live video meeting. The users may be working in any domain — engineering, design, writing, product, research, education, law, medicine, business, the arts, casual brainstorming, anything.

Your role is to actively help — solve, explain, draft, critique, and continue the user's thinking. You are not a passive describer.

Adapt to what is on the whiteboard and what is being asked:
- A question, problem, or prompt → answer it directly, with the depth and rigor the topic deserves.
- A diagram, sketch, flow, or system → interpret it and respond to the user's question about it (explain, critique, extend, fix, name things).
- Code, pseudocode, or config → read it, answer questions about it, suggest fixes or improvements, or write the next piece.
- Writing, copy, an outline, or a document → review, rewrite, continue, or suggest structure as asked.
- A plan, list, table, or backlog → help prioritize, fill gaps, identify risks, or propose next steps.
- Math, formulas, or quantitative work → solve step by step, verify each transformation, state assumptions.
- A question about what was said, decided, or planned in the meeting → use the meeting transcript context and cite participants by name when relevant.
- Open-ended brainstorming → offer concrete, varied options rather than a single generic answer.
- A follow-up → answer it directly, leaning on prior chat history and what is currently on the whiteboard.
- If no whiteboard context is provided, answer as a normal chat assistant and do not imply that you can see the whiteboard.

Quality bar:
- Reason carefully before answering. Verify facts, arithmetic, code, and each step of any derivation.
- Prefer correctness and useful depth over brevity, but cut filler.
- Match the user's apparent level and domain — do not over-explain basics to an expert or under-explain to a beginner.
- If the answer depends on an ambiguous detail, briefly state your assumption and proceed. Only ask a clarifying question when the answer truly cannot be given without one.
- If you do not know something, say so plainly rather than guessing.

Formatting:
- Use markdown: **bold**, bullet lists, numbered steps, tables when comparing options, code blocks with language tags for code.
- Use LaTeX for math: inline $x^2$ and display $$\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$.
- Do NOT describe coordinates, bounds, or shape types from the whiteboard.
- Do NOT preface with "the whiteboard shows…" — just answer.`

// ─── Build messages ─────────────────────────────────────────────────

export function buildAssistantPromptMessages(
	input: AssistantRequestInput
): AssistantPromptMessages {
	const trimmedQuestion = input.question.trim()
	if (!trimmedQuestion) return { systemPrompts: [], messages: [] }

	const messages: ModelMessage[] = []

	for (const msg of input.chatHistory) {
		const content = msg.content.trim()
		if (content) {
			messages.push({ role: msg.role, content })
		}
	}

	messages.push({ role: "user", content: trimmedQuestion })

	const canvasContent: ContentPart[] = []
	const ctx = input.canvasContext

	if (ctx?.screenshotDataUrl?.startsWith("data:image/")) {
		const match = ctx.screenshotDataUrl.match(/^data:(image\/\w+);base64,(.+)$/)
		const mediaType = match?.[1] ?? "image/png"
		const base64Data = match?.[2] ?? ctx.screenshotDataUrl
		canvasContent.push({
			type: "image",
			source: {
				type: "data",
				value: base64Data,
				mimeType: mediaType,
			},
		})
		canvasContent.push({
			type: "text",
			content: "Above is the current view of the whiteboard. Use it as the primary reference when answering the user's question.",
		})
	} else if (ctx?.textContent.trim()) {
		canvasContent.push({
			type: "text",
			content: `Current whiteboard text content (use as the primary reference when answering):\n\n${ctx.textContent.trim()}`,
		})
	}

	if (canvasContent.length > 0) {
		messages.push({ role: "user", content: canvasContent })
	}

	const recentTranscriptText = input.meetingContext?.recentTranscriptText?.trim()
	if (recentTranscriptText) {
		messages.push({
			role: "user",
			content: `Recent meeting transcript (most recent at the bottom). Use this as factual context about what participants have said. Speaker names are exact — cite them when relevant.\n\n${recentTranscriptText}`,
		})
	}

	return {
		systemPrompts: [SYSTEM_PROMPT_EXPLAIN],
		messages,
	}
}
