import { Extension, type Extensions } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { tipTapDefaultExtensions } from "tldraw";
import type { Editor, TLShape } from "tldraw";

// ─── Rich text node helpers ─────────────────────────────────────────────────

interface RichTextNode {
  type: string;
  text?: string;
  content?: RichTextNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
}

type RichTextDoc = {
  type: string;
  content: RichTextNode[];
  attrs?: Record<string, unknown>;
};

// ─── Symbol normalization (shared with table cells) ─────────────────────────

export function normalizeMathSymbols(value: string): string {
  return value
    // ─── First, compact spaced shortcuts into their two-character forms ───
    .replace(/<\s*-\s*>/g, "<->")
    .replace(/-\s+>/g, "->")
    .replace(/<\s+-/g, "<-")
    .replace(/<\s+=/g, "<=")
    .replace(/>\s+=/g, ">=")
    .replace(/!\s+=/g, "!=")
    .replace(/=\s+=/g, "==")
    .replace(/=\s+>/g, "=>")
    .replace(/&\s+&/g, "&&")
    .replace(/\|\s+\|/g, "||")
    // ─── Then, swap the ASCII forms for the corresponding math/logic glyphs ───
    .replace(/<->/g, "\u2194") // ↔
    .replace(/<=/g, "\u2264") // ≤
    .replace(/>=/g, "\u2265") // ≥
    .replace(/!=/g, "\u2260") // ≠
    .replace(/=>/g, "\u21D2") // ⇒
    .replace(/->/g, "\u2192") // →
    .replace(/<-/g, "\u2190") // ←
    .replace(/&&/g, "\u2227") // ∧
    .replace(/\|\|/g, "\u2228") // ∨
    .replace(/~(?=[A-Za-z(])/g, "\u00AC"); // ¬
}

// ─── Rich text tree walker (for store-level normalization) ──────────────────

/**
 * Walk a TLRichText JSON tree and normalize math/logic ASCII shortcuts in
 * every text node's `.text` field. Returns the same object reference when no
 * changes are needed (important for tldraw's reactivity — avoids unnecessary
 * re-renders and history entries).
 */
export function normalizeRichTextMath(richText: unknown): unknown {
  if (!richText || typeof richText !== "object") return richText;

  const doc = richText as RichTextDoc;
  if (!Array.isArray(doc.content)) return richText;

  let changed = false;
  const newContent = doc.content.map((node) => {
    const result = normalizeNode(node);
    if (result !== node) changed = true;
    return result;
  });

  if (!changed) return richText;

  return { ...doc, content: newContent };
}

function normalizeNode(node: RichTextNode): RichTextNode {
  // Text leaf node — normalize the text value
  if (node.type === "text" && typeof node.text === "string") {
    const normalized = normalizeMathSymbols(node.text);
    if (normalized === node.text) return node;
    return { ...node, text: normalized };
  }

  // Container node — recurse into children
  if (Array.isArray(node.content)) {
    let changed = false;
    const newContent = node.content.map((child) => {
      const result = normalizeNode(child);
      if (result !== child) changed = true;
      return result;
    });

    if (!changed) return node;
    return { ...node, content: newContent };
  }

  return node;
}

// ─── TipTap extension ───────────────────────────────────────────────────────

const mathSymbolPluginKey = new PluginKey("mathSymbolNormalization");

/**
 * TipTap extension that normalizes math/logic ASCII shortcuts inside the
 * ProseMirror editor as the user types. Uses `appendTransaction` so the
 * normalization happens inside the editor's transaction pipeline — before
 * `onUpdate` fires and `doc.toJSON()` is called. This means:
 *
 * 1. The TipTap editor's internal state already has normalized text
 * 2. `rInitialRichText.current` (set in onUpdate) matches the stored shape
 * 3. No cursor-position reset from RichTextArea's useLayoutEffect
 */
export const MathSymbolNormalization = Extension.create({
  name: "mathSymbolNormalization",

  addProseMirrorPlugins() {
    const normalize = normalizeMathSymbols;

    return [
      new Plugin({
        key: mathSymbolPluginKey,
        appendTransaction(_transactions, _oldState, newState) {
          const tr = newState.tr;
          let modified = false;

          // Collect all text replacements. We apply them in reverse order
          // to keep earlier positions stable.
          const replacements: Array<{
            from: number;
            to: number;
            text: string;
          }> = [];

          newState.doc.descendants((node, pos) => {
            if (node.isText && node.text) {
              const normalized = normalize(node.text);
              if (normalized !== node.text) {
                replacements.push({
                  from: pos,
                  to: pos + node.text.length,
                  text: normalized,
                });
              }
            }
            return true;
          });

          if (replacements.length === 0) return undefined;
          modified = true;

          // Apply in reverse order to preserve positions
          for (let i = replacements.length - 1; i >= 0; i--) {
            const { from, to, text } = replacements[i];
            tr.insertText(text, from, to);
          }

          return modified ? tr : undefined;
        },
      }),
    ];
  },
});

// ─── TipTap extensions with math normalization ──────────────────────────────

/**
 * The full set of TipTap extensions for the whiteboard, combining tldraw's
 * defaults with the math symbol normalization extension. Pass this via
 * `options.text.tipTapConfig.extensions` to the `<Tldraw>` component.
 */
export const whiteboardTipTapExtensions: Extensions = [
  ...tipTapDefaultExtensions,
  MathSymbolNormalization,
];

// ─── Shape types that carry a richText prop ─────────────────────────────────

const RICH_TEXT_SHAPE_TYPES = new Set(["text", "geo", "note", "arrow"]);

function shapeHasRichText(shape: TLShape): shape is TLShape & {
  props: { richText: unknown };
} {
  return RICH_TEXT_SHAPE_TYPES.has(shape.type) && "richText" in shape.props;
}

// ─── Side effect registration ───────────────────────────────────────────────

/**
 * Registers side effects that normalize math/logic ASCII shortcuts in the
 * richText prop of shapes. The TipTap extension handles live editing; these
 * handlers cover paste, programmatic creation, and store-level updates (e.g.
 * AI assistant edits, undo/redo from external sources).
 *
 * Returns a cleanup function that unregisters both handlers.
 */
export function registerTextNormalization(editor: Editor): () => void {
  const normalizeProps = (shape: Parameters<typeof shapeHasRichText>[0]) => {
    if (!shapeHasRichText(shape)) return shape;
    const props = shape.props as { richText: unknown };
    const normalized = normalizeRichTextMath(props.richText);
    if (normalized === props.richText) return shape;
    return { ...shape, props: { ...shape.props, richText: normalized } } as typeof shape;
  };

  const unregisterBeforeCreate =
    editor.sideEffects.registerBeforeCreateHandler(
      "shape",
      (shape, source) => {
        if (source !== "user") return shape;
        return normalizeProps(shape);
      }
    );

  const unregisterBeforeChange =
    editor.sideEffects.registerBeforeChangeHandler(
      "shape",
      (_prev, next, source) => {
        if (source !== "user") return next;
        return normalizeProps(next);
      }
    );

  return () => {
    unregisterBeforeCreate();
    unregisterBeforeChange();
  };
}
