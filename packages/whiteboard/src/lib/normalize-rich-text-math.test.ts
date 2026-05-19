import { describe, expect, it } from "vitest";
import {
  normalizeMathSymbols,
  normalizeRichTextMath,
} from "./normalize-rich-text-math";

// ─── normalizeMathSymbols ────────────────────────────────────────────────

describe("normalizeMathSymbols", () => {
  it("converts ASCII arrows to glyphs", () => {
    expect(normalizeMathSymbols("x -> y")).toBe("x \u2192 y"); // →
    expect(normalizeMathSymbols("x <- y")).toBe("x \u2190 y"); // ←
    expect(normalizeMathSymbols("x <-> y")).toBe("x \u2194 y"); // ↔
    expect(normalizeMathSymbols("x => y")).toBe("x \u21D2 y"); // ⇒
  });

  it("converts spaced arrow shortcuts to glyphs", () => {
    expect(normalizeMathSymbols("x - > y")).toBe("x \u2192 y");
    expect(normalizeMathSymbols("x < - y")).toBe("x \u2190 y");
    expect(normalizeMathSymbols("x < - > y")).toBe("x \u2194 y");
    expect(normalizeMathSymbols("x = > y")).toBe("x \u21D2 y");
  });

  it("converts comparison operators to math glyphs", () => {
    expect(normalizeMathSymbols("x <= y")).toBe("x \u2264 y"); // ≤
    expect(normalizeMathSymbols("x >= y")).toBe("x \u2265 y"); // ≥
    expect(normalizeMathSymbols("x != y")).toBe("x \u2260 y"); // ≠
    expect(normalizeMathSymbols("x < = y")).toBe("x \u2264 y");
    expect(normalizeMathSymbols("x > = y")).toBe("x \u2265 y");
    expect(normalizeMathSymbols("x ! = y")).toBe("x \u2260 y");
  });

  it("converts boolean operators to logic glyphs", () => {
    expect(normalizeMathSymbols("A && B")).toBe("A \u2227 B"); // ∧
    expect(normalizeMathSymbols("A || B")).toBe("A \u2228 B"); // ∨
    expect(normalizeMathSymbols("A & & B")).toBe("A \u2227 B");
    expect(normalizeMathSymbols("A | | B")).toBe("A \u2228 B");
  });

  it("converts tilde negation before symbolic expressions", () => {
    expect(normalizeMathSymbols("~A")).toBe("\u00ACA"); // ¬
    expect(normalizeMathSymbols("~(A -> B)")).toBe("\u00AC(A \u2192 B)");
  });

  it("leaves plain text unchanged", () => {
    expect(normalizeMathSymbols("Hello world")).toBe("Hello world");
    expect(normalizeMathSymbols("")).toBe("");
    expect(normalizeMathSymbols("123 + 456")).toBe("123 + 456");
  });
});

// ─── normalizeRichTextMath ───────────────────────────────────────────────

describe("normalizeRichTextMath", () => {
  it("returns same reference when no changes are needed", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    };
    const result = normalizeRichTextMath(doc);
    expect(result).toBe(doc); // same reference
  });

  it("normalizes a single text node", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x -> y" }] }],
    };
    const result = normalizeRichTextMath(doc) as typeof doc;
    expect(result).not.toBe(doc);
    expect(result.content[0].content[0].text).toBe("x \u2192 y");
  });

  it("normalizes multi-paragraph rich text", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A -> B" }] },
        { type: "paragraph", content: [{ type: "text", text: "C <= D" }] },
      ],
    };
    const result = normalizeRichTextMath(doc) as typeof doc;
    expect(result.content[0].content[0].text).toBe("A \u2192 B");
    expect(result.content[1].content[0].text).toBe("C \u2264 D");
  });

  it("preserves marks (bold, italic) on text nodes", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x -> y",
              marks: [{ type: "bold" }],
            },
          ],
        },
      ],
    };
    const result = normalizeRichTextMath(doc) as typeof doc;
    const textNode = result.content[0].content[0];
    expect(textNode.text).toBe("x \u2192 y");
    expect(textNode.marks).toEqual([{ type: "bold" }]);
  });

  it("handles nested structures (lists)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "item -> one" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = normalizeRichTextMath(doc) as typeof doc;
    const listItemText =
      result.content[0].content[0].content[0].content[0];
    expect(listItemText.text).toBe("item \u2192 one");
  });

  it("handles empty paragraphs (no content array)", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
    const result = normalizeRichTextMath(doc);
    expect(result).toBe(doc); // no changes
  });

  it("handles mixed changed and unchanged paragraphs", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "plain text" }] },
        { type: "paragraph", content: [{ type: "text", text: "A -> B" }] },
      ],
    };
    const result = normalizeRichTextMath(doc) as typeof doc;
    expect(result).not.toBe(doc);
    // First paragraph unchanged internally
    expect(result.content[0].content[0].text).toBe("plain text");
    // Second paragraph normalized
    expect(result.content[1].content[0].text).toBe("A \u2192 B");
  });

  it("returns input unchanged for non-object values", () => {
    expect(normalizeRichTextMath(null)).toBe(null);
    expect(normalizeRichTextMath(undefined)).toBe(undefined);
    expect(normalizeRichTextMath("string")).toBe("string");
    expect(normalizeRichTextMath(42)).toBe(42);
  });

  it("returns input unchanged for object without content array", () => {
    const obj = { type: "doc" };
    expect(normalizeRichTextMath(obj)).toBe(obj);
  });
});
