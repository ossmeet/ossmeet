import { describe, expect, it } from "vitest";
import { normalizeTableCellText } from "./table-shape-util";

describe("normalizeTableCellText", () => {
  it("converts spaced arrow shortcuts to glyphs", () => {
    expect(normalizeTableCellText("x - > y")).toBe("x → y");
    expect(normalizeTableCellText("x < - y")).toBe("x ← y");
    expect(normalizeTableCellText("x < - > y")).toBe("x ↔ y");
    expect(normalizeTableCellText("x = > y")).toBe("x ⇒ y");
  });

  it("converts ASCII arrows directly to glyphs", () => {
    expect(normalizeTableCellText("x -> y")).toBe("x → y");
    expect(normalizeTableCellText("x <- y")).toBe("x ← y");
    expect(normalizeTableCellText("x <-> y")).toBe("x ↔ y");
    expect(normalizeTableCellText("x => y")).toBe("x ⇒ y");
  });

  it("converts comparison operators to math glyphs", () => {
    expect(normalizeTableCellText("x < = y")).toBe("x ≤ y");
    expect(normalizeTableCellText("x > = y")).toBe("x ≥ y");
    expect(normalizeTableCellText("x ! = y")).toBe("x ≠ y");
    expect(normalizeTableCellText("x <= y")).toBe("x ≤ y");
    expect(normalizeTableCellText("x >= y")).toBe("x ≥ y");
    expect(normalizeTableCellText("x != y")).toBe("x ≠ y");
  });

  it("converts boolean operators to logic glyphs", () => {
    expect(normalizeTableCellText("A & & B")).toBe("A ∧ B");
    expect(normalizeTableCellText("A | | B")).toBe("A ∨ B");
    expect(normalizeTableCellText("A && B")).toBe("A ∧ B");
    expect(normalizeTableCellText("A || B")).toBe("A ∨ B");
  });

  it("converts tilde negation before symbolic expressions", () => {
    expect(normalizeTableCellText("~A")).toBe("¬A");
    expect(normalizeTableCellText("~(A -> B)")).toBe("¬(A → B)");
  });
});
