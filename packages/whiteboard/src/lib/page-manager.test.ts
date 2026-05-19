import { describe, expect, it } from "vitest";
import type { Editor, TLShape, TLShapeId } from "tldraw";
import { PageManager } from "./page-manager";

type FakeShape = {
  id: TLShapeId;
  type: TLShape["type"];
  parentId: TLShapeId;
  x: number;
  y: number;
  props?: {
    name?: string;
    h?: number;
    w?: number;
  };
  meta?: Record<string, unknown>;
  isLocked?: boolean;
};

class FakeEditor {
  private readonly pageId = "page:page" as unknown as TLShapeId;
  private readonly shapes = new Map<TLShapeId, FakeShape>();

  getCurrentPageId() {
    return this.pageId;
  }

  getCurrentPageShapes() {
    return Array.from(this.shapes.values());
  }

  getCurrentPageShapesSorted() {
    return Array.from(this.shapes.values());
  }

  getShape(id: TLShapeId) {
    return this.shapes.get(id) ?? null;
  }

  createShape(shape: FakeShape) {
    this.shapes.set(shape.id, shape);
  }

  updateShapes(updates: Array<Partial<FakeShape> & Pick<FakeShape, "id" | "type">>) {
    for (const update of updates) {
      const current = this.shapes.get(update.id);
      if (!current) continue;
      this.shapes.set(update.id, {
        ...current,
        ...update,
        props: update.props
          ? {
              ...(current.props ?? {}),
              ...update.props,
            }
          : current.props,
        meta: update.meta
          ? {
              ...(current.meta ?? {}),
              ...update.meta,
            }
          : current.meta,
      });
    }
  }

  getShapePageBounds(shapeOrId: TLShapeId | FakeShape) {
    const shape =
      typeof shapeOrId === "string"
        ? this.shapes.get(shapeOrId as TLShapeId)
        : shapeOrId;
    if (!shape) return null;

    const width = shape.type === "frame" ? (shape.props?.w ?? 800) : 100;
    const height = shape.type === "frame" ? (shape.props?.h ?? 1000) : 100;

    return {
      center: {
        x: shape.x + width / 2,
        y: shape.y + height / 2,
      },
    };
  }

  getShapeMaskedPageBounds(shapeOrId: TLShapeId | FakeShape) {
    return this.getShapePageBounds(shapeOrId);
  }
}

describe("PageManager.insertPagesAt", () => {
  it("shifts loose top-level content with the pages below the insertion point", () => {
    const editor = new FakeEditor();
    const page1Id = "shape:page-1" as TLShapeId;
    const page2Id = "shape:page-2" as TLShapeId;
    const looseShapeId = "shape:loose" as TLShapeId;

    editor.createShape({
      id: page1Id,
      type: "frame",
      parentId: editor.getCurrentPageId(),
      x: 0,
      y: 0,
      props: { name: "Page 1", w: 800, h: 1000 },
      meta: { isPageFrame: true },
    });
    editor.createShape({
      id: page2Id,
      type: "frame",
      parentId: editor.getCurrentPageId(),
      x: 0,
      y: 1100,
      props: { name: "Page 2", w: 800, h: 1000 },
      meta: { isPageFrame: true },
    });
    editor.createShape({
      id: looseShapeId,
      type: "geo",
      parentId: editor.getCurrentPageId(),
      x: 100,
      y: 1200,
      props: {},
    });

    const manager = new PageManager(editor as unknown as Editor, {
      width: 800,
      height: 1000,
      spacing: 100,
    });

    manager.insertPagesAt(1, 1);

    expect(editor.getShape(looseShapeId)?.y).toBe(2300);
    expect(manager.getPages().map((page) => page.number)).toEqual([1, 2, 3]);
    expect(manager.getPages()[2]?.id).toBe(page2Id);
  });
});

describe("PageManager.isPageFrame (L31)", () => {
  it("identifies page frames by meta.isPageFrame flag", () => {
    const editor = new FakeEditor();
    editor.createShape({
      id: "shape:pf-1" as TLShapeId,
      type: "frame",
      parentId: editor.getCurrentPageId(),
      x: 0,
      y: 0,
      props: { name: "Page 1", w: 800, h: 1000 },
      meta: { isPageFrame: true },
    });
    // A regular frame without the meta flag
    editor.createShape({
      id: "shape:regular" as TLShapeId,
      type: "frame",
      parentId: editor.getCurrentPageId(),
      x: 0,
      y: 1100,
      props: { name: "My Frame", w: 400, h: 300 },
    });

    const manager = new PageManager(editor as unknown as Editor, {
      width: 800,
      height: 1000,
      spacing: 100,
    });

    // Only the frame with meta.isPageFrame should be detected as a page
    expect(manager.getPages().length).toBe(1);
    expect(manager.getPages()[0].id).toBe("shape:pf-1" as TLShapeId);
  });

  it("does not match frames named 'Page ...' without the meta flag", () => {
    const editor = new FakeEditor();
    editor.createShape({
      id: "shape:fake-page" as TLShapeId,
      type: "frame",
      parentId: editor.getCurrentPageId(),
      x: 0,
      y: 0,
      props: { name: "Page created by user", w: 500, h: 400 },
      // No meta.isPageFrame flag
    });

    const manager = new PageManager(editor as unknown as Editor, {
      width: 800,
      height: 1000,
      spacing: 100,
    });

    expect(manager.getPages().length).toBe(0);
  });
});

describe("PageManager.createPage", () => {
  it("creates pages with the isPageFrame meta flag", () => {
    const editor = new FakeEditor();
    const manager = new PageManager(editor as unknown as Editor, {
      width: 800,
      height: 1000,
      spacing: 100,
    });

    const id = manager.createPage();
    expect(id).not.toBeNull();

    const shape = editor.getShape(id!);
    expect(shape?.meta).toEqual({ isPageFrame: true });

    // Now it should appear in getPages
    expect(manager.getPages().length).toBe(1);
  });

  it("repairs an existing initial page frame that is missing the meta flag", () => {
    const editor = new FakeEditor();
    const existingPageId = "shape:page-1" as TLShapeId;
    editor.createShape({
      id: existingPageId,
      type: "frame",
      parentId: editor.getCurrentPageId(),
      x: 0,
      y: 0,
      props: { name: "Page 1", w: 800, h: 1000 },
    });

    const manager = new PageManager(editor as unknown as Editor, {
      width: 800,
      height: 1000,
      spacing: 100,
    });

    const id = manager.createPage();

    expect(id).toBe(existingPageId);
    expect(editor.getShape(existingPageId)?.meta).toEqual({ isPageFrame: true });
    expect(manager.getPages()).toEqual([
      {
        id: existingPageId,
        number: 1,
        y: 0,
        height: 1000,
      },
    ]);
  });
});

describe("PageManager.compactPages", () => {
  it("closes frame gaps and shifts loose content by the matching cumulative delta", () => {
    const editor = new FakeEditor();
    const page1Id = "shape:page-1" as TLShapeId;
    const page2Id = "shape:page-2" as TLShapeId;
    const page3Id = "shape:page-3" as TLShapeId;
    const looseNearPage2Id = "shape:loose-2" as TLShapeId;
    const looseNearPage3Id = "shape:loose-3" as TLShapeId;

    editor.createShape({
      id: page1Id,
      type: "frame",
      parentId: editor.getCurrentPageId(),
      x: 0,
      y: 0,
      props: { name: "Page 1", w: 800, h: 1000 },
      meta: { isPageFrame: true },
    });
    editor.createShape({
      id: page2Id,
      type: "frame",
      parentId: editor.getCurrentPageId(),
      x: 0,
      y: 2200,
      props: { name: "Page 4", w: 800, h: 1000 },
      meta: { isPageFrame: true },
    });
    editor.createShape({
      id: page3Id,
      type: "frame",
      parentId: editor.getCurrentPageId(),
      x: 0,
      y: 4400,
      props: { name: "Page 5", w: 800, h: 1000 },
      meta: { isPageFrame: true },
    });
    editor.createShape({
      id: looseNearPage2Id,
      type: "geo",
      parentId: editor.getCurrentPageId(),
      x: 50,
      y: 2300,
      props: {},
    });
    editor.createShape({
      id: looseNearPage3Id,
      type: "geo",
      parentId: editor.getCurrentPageId(),
      x: 75,
      y: 4500,
      props: {},
    });

    const manager = new PageManager(editor as unknown as Editor, {
      width: 800,
      height: 1000,
      spacing: 100,
    });

    manager.compactPages();

    expect(editor.getShape(page1Id)?.y).toBe(0);
    expect(editor.getShape(page2Id)?.y).toBe(1100);
    expect(editor.getShape(page3Id)?.y).toBe(2200);
    expect(editor.getShape(looseNearPage2Id)?.y).toBe(1200);
    expect(editor.getShape(looseNearPage3Id)?.y).toBe(2300);
    expect(manager.getPages().map((page) => page.number)).toEqual([1, 2, 3]);
    expect(editor.getShape(page2Id)?.props?.name).toBe("Page 2");
    expect(editor.getShape(page3Id)?.props?.name).toBe("Page 3");
  });
});
