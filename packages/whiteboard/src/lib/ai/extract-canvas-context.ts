/**
 * Extract canvas context for AI assistant.
 * Gets visible text, shape information, and viewport bounds for analysis.
 * Does NOT include shape creation data — read-only context extraction.
 */

import {
	Box,
	FileHelpers,
	type Editor,
	type TLShape,
	type TLShapeId,
} from "tldraw"

// ─── Types ───────────────────────────────────────────────────────────

export interface CanvasContext {
	/** All visible text content concatenated */
	textContent: string
	/** Simplified shape descriptions for context */
	visibleShapes: ShapeDescription[]
	/** IDs of currently selected shapes */
	selectedShapeIds: string[]
	/** Viewport bounds */
	viewportBounds: { x: number; y: number; w: number; h: number }
	/** Base64 screenshot of visible region (JPEG) */
	screenshotDataUrl?: string
	/** Total shape count in viewport */
	shapeCount: number
}

export interface ShapeDescription {
	id: string
	type: string
	text?: string
	bounds: { x: number; y: number; w: number; h: number }
}

const MAX_SCREENSHOT_DATA_URL_LENGTH = 1_400_000

// ─── Main Extraction ─────────────────────────────────────────────────

export async function extractCanvasContext(editor: Editor): Promise<CanvasContext> {
	const viewportBounds = editor.getViewportPageBounds()
	const allShapes = editor.getCurrentPageShapesSorted()
	const selectedShapeIds = editor.getSelectedShapeIds().map((shapeId) =>
		String(shapeId)
	)

	// Filter to shapes in viewport
	const visibleShapes = allShapes.filter((shape) => {
		const bounds = editor.getShapeMaskedPageBounds(shape)
		if (!bounds) return false

		return (
			bounds.x < viewportBounds.x + viewportBounds.w &&
			bounds.y < viewportBounds.y + viewportBounds.h &&
			bounds.x + bounds.w > viewportBounds.x &&
			bounds.y + bounds.h > viewportBounds.y
		)
	})

	// Extract text and descriptions
	const textParts: string[] = []
	const shapeDescriptions: ShapeDescription[] = []

	for (const shape of visibleShapes) {
		const description = describeShape(editor, shape)
		shapeDescriptions.push(description)

		if (description.text) {
			textParts.push(description.text)
		}
	}

	const shapeIds = visibleShapes.map((shape) => shape.id)
	const screenshotDataUrl =
		shapeIds.length > 0
			? await captureViewportScreenshot(editor, shapeIds, viewportBounds)
			: undefined

	return {
		textContent: textParts.join("\n\n"),
		visibleShapes: shapeDescriptions,
		selectedShapeIds,
		viewportBounds: {
			x: Math.round(viewportBounds.x),
			y: Math.round(viewportBounds.y),
			w: Math.round(viewportBounds.w),
			h: Math.round(viewportBounds.h),
		},
		screenshotDataUrl,
		shapeCount: visibleShapes.length,
	}
}

// ─── Shape Description ───────────────────────────────────────────────

function describeShape(editor: Editor, shape: TLShape): ShapeDescription {
	const bounds = editor.getShapeMaskedPageBounds(shape)
	const boundsObj = bounds
		? {
				x: Math.round(bounds.x),
				y: Math.round(bounds.y),
				w: Math.round(bounds.w),
				h: Math.round(bounds.h),
		  }
		: { x: 0, y: 0, w: 0, h: 0 }

	const text = extractShapeText(editor, shape)
	return {
		id: shape.id,
		type: shape.type,
		text,
		bounds: boundsObj,
	}
}

// ─── Text Extraction ─────────────────────────────────────────────────

// Max text per shape — keep payload size reasonable for the LLM call
const MAX_SHAPE_TEXT_LENGTH = 2000

function extractShapeText(editor: Editor, shape: TLShape): string | undefined {
	const util = editor.getShapeUtil(shape)
	const text = util.getText(shape)
	if (!text) return undefined
	const normalized = text.trim()
	if (normalized.length === 0) return undefined
	return normalized.length > MAX_SHAPE_TEXT_LENGTH
		? normalized.slice(0, MAX_SHAPE_TEXT_LENGTH) + "…"
		: normalized
}

async function captureViewportScreenshot(
	editor: Editor,
	shapeIds: TLShapeId[],
	viewportBounds: { x: number; y: number; w: number; h: number }
): Promise<string | undefined> {
	const maxDimension = Math.max(viewportBounds.w, viewportBounds.h)
	const scale = maxDimension > 2400 ? 2400 / maxDimension : 1
	try {
		const result = await editor.toImage(shapeIds, {
			format: "jpeg",
			bounds: Box.From(viewportBounds),
			background: true,
			padding: 0,
			pixelRatio: 1,
			scale,
		})

		const dataUrl = await FileHelpers.blobToDataUrl(result.blob)
		if (dataUrl.length > MAX_SCREENSHOT_DATA_URL_LENGTH) {
			console.warn(
				"[Whiteboard Assistant] Screenshot too large, skipping image context."
			)
			return undefined
		}
		return dataUrl
	} catch (error) {
		console.warn(
			"[Whiteboard Assistant] Failed to capture viewport screenshot:",
			error
		)
		return undefined
	}
}

// ─── Utilities ───────────────────────────────────────────────────────

/**
 * Extract only the text content (no shape metadata) for simple text-based analysis
 */
export async function extractVisibleText(editor: Editor): Promise<string> {
	const context = await extractCanvasContext(editor)
	return context.textContent
}

/**
 * Get a summary of what's visible on the canvas
 */
export function getCanvasSummary(context: CanvasContext): string {
	const { shapeCount, textContent, visibleShapes } = context

	const shapeTypes = new Map<string, number>()
	let textShapeCount = 0

	for (const shape of visibleShapes) {
		shapeTypes.set(shape.type, (shapeTypes.get(shape.type) || 0) + 1)
		if (shape.text) textShapeCount++
	}

	const typesList = Array.from(shapeTypes.entries())
		.map(([type, count]) => `${count} ${type}${count !== 1 ? "s" : ""}`)
		.join(", ")

	const hasText = textContent.length > 0
	const textPreview = hasText ? textContent.slice(0, 100) : "no text"

	return `Canvas has ${shapeCount} shapes (${typesList}). ${textShapeCount} shapes contain text. Text preview: "${textPreview}${textContent.length > 100 ? "..." : ""}"`
}
