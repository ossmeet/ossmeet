import { describe, expect, it } from "vitest"
import { buildAssistantPromptMessages } from "./assistant-prompt"

const baseCanvasContext = {
	textContent: "",
	shapeCount: 0,
	viewportBounds: { x: 0, y: 0, w: 800, h: 600 },
}

describe("buildAssistantPromptMessages", () => {
	it("adds recent transcript context after the user question", () => {
		const result = buildAssistantPromptMessages({
			question: "Summarize what we decided.",
			canvasContext: baseCanvasContext,
			chatHistory: [],
			meetingContext: {
				recentTranscriptText:
					"[10:00:01 Atiq]: Ship the PDF export first.\n[10:00:04 Sam]: I will handle tests.",
			},
			mode: "explain",
		})

		expect(result.messages).toHaveLength(2)
		expect(result.messages[0]).toMatchObject({
			role: "user",
			content: "Summarize what we decided.",
		})
		expect(result.messages[1]?.content).toContain("Recent meeting transcript")
		expect(result.messages[1]?.content).toContain("Ship the PDF export first.")
		expect(result.messages[1]?.content).toContain("Speaker names are exact")
	})

	it("includes the transcript verbatim in the meeting context message", () => {
		const result = buildAssistantPromptMessages({
			question: "What is next?",
			canvasContext: baseCanvasContext,
			chatHistory: [],
			meetingContext: {
				recentTranscriptText: "[10:00:01 User]: Let's try Postgres for the new service.",
			},
			mode: "explain",
		})

		expect(result.systemPrompts[0]).toContain("meeting transcript")
		expect(result.messages.at(-1)?.content).toContain(
			"Let's try Postgres for the new service.",
		)
	})

	it("allows chat-only questions without whiteboard context", () => {
		const result = buildAssistantPromptMessages({
			question: "What is a good warmup question for a workshop?",
			chatHistory: [],
			mode: "explain",
		})

		expect(result.messages).toEqual([
			{
				role: "user",
				content: "What is a good warmup question for a workshop?",
			},
		])
		expect(result.systemPrompts[0]).toContain("no whiteboard context")
	})
})
