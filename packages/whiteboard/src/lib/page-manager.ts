import type {
  Editor,
  TLFrameShape,
  TLShapeId,
  TLShapePartial,
} from "tldraw";
import { createShapeId } from "@tldraw/tlschema";
import { WHITEBOARD_CONFIG } from "./constants";
import { withPageFrameMutationAllowance } from "./protect-page-frames";

const { PAGE_WIDTH, PAGE_HEIGHT, PAGE_SPACING, MAX_PAGES } = WHITEBOARD_CONFIG;
const INITIAL_PAGE_FRAME_ID = createShapeId("page-1");

export interface WhiteboardPage {
  id: TLShapeId;
  number: number;
  y: number;
  height: number;
}

// Use a meta flag for reliable page-frame detection instead of
// relying on the "Page " name prefix, which is brittle and could match
// user-created frames that happen to start with "Page ".
function isPageFrame(shape: TLFrameShape): boolean {
  return (shape.meta as Record<string, unknown> | undefined)?.isPageFrame === true;
}

export interface PageDimensions {
  width: number;
  height: number;
  spacing: number;
}

export class PageManager {
  private dimensions: PageDimensions;

  constructor(
    private editor: Editor,
    dimensions?: PageDimensions
  ) {
    this.dimensions = dimensions ?? {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      spacing: PAGE_SPACING,
    };
  }

  updateDimensions(dimensions: PageDimensions) {
    this.dimensions = dimensions;
  }

  getDimensions(): PageDimensions {
    return this.dimensions;
  }

  getPages(): WhiteboardPage[] {
    const frames = this.editor
      .getCurrentPageShapes()
      .filter((shape): shape is TLFrameShape => shape.type === "frame")
      .filter(isPageFrame)
      .sort((a, b) => a.y - b.y);

    return frames.map((frame, index) => ({
      id: frame.id,
      number: index + 1,
      y: frame.y,
      height: (frame.props as { h: number }).h ?? this.dimensions.height,
    }));
  }

  createPage(): TLShapeId | null {
    const pages = this.getPages();

    if (pages.length >= MAX_PAGES) {
      console.warn(`[PageManager] Maximum page limit (${MAX_PAGES}) reached`);
      return null;
    }

    const pageNumber = pages.length + 1;
    const lastPage = pages[pages.length - 1];
    const y =
      pages.length === 0
        ? 0
        : lastPage.y + lastPage.height + this.dimensions.spacing;

    const frameId = pageNumber === 1 ? INITIAL_PAGE_FRAME_ID : createShapeId();
    if (pageNumber === 1 && this.editor.getShape(frameId)) {
      const existingFrame = this.editor.getShape(frameId);
      if (existingFrame?.type === "frame" && !isPageFrame(existingFrame)) {
        this.editor.updateShapes([
          {
            id: frameId,
            type: "frame",
            props: {
              name:
                (existingFrame as TLFrameShape).props.name?.startsWith("Page ")
                  ? (existingFrame as TLFrameShape).props.name
                  : "Page 1",
            },
            meta: {
              ...(existingFrame.meta as Record<string, unknown> | undefined),
              isPageFrame: true,
            },
          },
        ]);
      }
      return frameId;
    }

    this.editor.createShape({
      id: frameId,
      type: "frame",
      x: 0,
      y,
      props: {
        w: this.dimensions.width,
        h: this.dimensions.height,
        name: `Page ${pageNumber}`,
        color: "grey",
      },
      meta: { isPageFrame: true },
    });

    return frameId;
  }

  createPages(count: number): TLShapeId[] {
    const ids: TLShapeId[] = [];
    for (let i = 0; i < count; i++) {
      const id = this.createPage();
      if (!id) break;
      ids.push(id);
    }
    return ids;
  }

  initialize() {
    if (this.getPages().length === 0) {
      this.createPage();
    }
  }

  getCurrentPage(): number {
    const pages = this.getPages();
    if (pages.length === 0) return 1;

    const viewportCenterY = this.editor.getViewportPageBounds().center.y;

    for (let i = 0; i < pages.length; i += 1) {
      const pageTop = pages[i].y;
      const pageBottom = pageTop + pages[i].height;
      if (viewportCenterY >= pageTop && viewportCenterY <= pageBottom) {
        return i + 1;
      }
    }

    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < pages.length; i++) {
      const pageCenterY = pages[i].y + pages[i].height / 2;
      const dist = Math.abs(viewportCenterY - pageCenterY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    return nearestIdx + 1;
  }

  shiftLooseContentAtOrBelow(y: number, deltaY: number) {
    if (Math.abs(deltaY) < 0.5) return;

    const currentPageId = this.editor.getCurrentPageId();
    const updates: TLShapePartial[] = [];

    for (const shape of this.editor.getCurrentPageShapes()) {
      if (shape.type === "frame" || shape.parentId !== currentPageId) continue;

      const bounds = this.editor.getShapePageBounds(shape.id);
      if (!bounds || bounds.center.y < y) continue;

      updates.push({
        id: shape.id,
        type: shape.type,
        y: shape.y + deltaY,
      });
    }

    if (updates.length > 0) {
      this.editor.updateShapes(updates);
    }
  }

  insertPagesAt(index: number, count: number): TLShapeId[] {
    return withPageFrameMutationAllowance(this.editor, () => {
      const pages = this.getPages();
      const available = MAX_PAGES - pages.length;
      const actualCount = Math.min(count, available);
      if (actualCount <= 0) return [];

      const clampedIndex = Math.max(0, Math.min(index, pages.length));
      const insertionY =
        clampedIndex < pages.length
          ? pages[clampedIndex].y
          : pages.length === 0
            ? 0
            : pages[pages.length - 1].y +
              pages[pages.length - 1].height +
              this.dimensions.spacing;

      const pagesToShift = pages.slice(clampedIndex);
      const shiftAmount =
        actualCount * (this.dimensions.height + this.dimensions.spacing);

      if (pagesToShift.length > 0) {
        this.editor.updateShapes(
          pagesToShift.map((p) => ({
            id: p.id,
            type: "frame" as const,
            y: p.y + shiftAmount,
          }))
        );
      }

      // Some shapes can still be top-level instead of frame children
      // (for example older content or shapes created by integrations).
      // If we only move the frames, that loose content stays behind and
      // visually occupies the newly inserted slot.
      this.shiftLooseContentAtOrBelow(insertionY, shiftAmount);

      const ids: TLShapeId[] = [];
      for (let i = 0; i < actualCount; i++) {
        // use actual prior frame height, not the default dimension, so
        // frames with custom heights (e.g. from PDF import) are spaced correctly
        const priorFrameHeight =
          clampedIndex > 0
            ? pages[clampedIndex - 1].height
            : this.dimensions.height;
        const y =
          clampedIndex === 0
            ? i * (this.dimensions.height + this.dimensions.spacing)
            : pages[clampedIndex - 1].y +
              priorFrameHeight +
              this.dimensions.spacing +
              i * (this.dimensions.height + this.dimensions.spacing);

        const frameId = createShapeId();
        this.editor.createShape({
          id: frameId,
          type: "frame",
          x: 0,
          y,
          props: {
            w: this.dimensions.width,
            h: this.dimensions.height,
            name: `Page ${clampedIndex + i + 1}`,
            color: "grey",
          },
          meta: { isPageFrame: true },
        });
        ids.push(frameId);
      }

      this.renumberPages();
      return ids;
    });
  }

  compactPages() {
    return withPageFrameMutationAllowance(this.editor, () => {
      const pages = this.getPages();
      if (pages.length === 0) return;

      const currentPageId = this.editor.getCurrentPageId();
      const frameUpdates: { id: TLShapeId; type: "frame"; y: number }[] = [];
      const pageDeltas = new Map<TLShapeId, number>();

      let expectedY = 0;
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const deltaY = expectedY - page.y;
        pageDeltas.set(page.id, deltaY);
        if (Math.abs(deltaY) > 0.5) {
          frameUpdates.push({
            id: page.id,
            type: "frame",
            y: expectedY,
          });
        }
        expectedY += page.height + this.dimensions.spacing;
      }

      const looseUpdates: TLShapePartial[] = [];
      // Pages are sorted by Y, so binary search for the enclosing page.
      for (const shape of this.editor.getCurrentPageShapes()) {
        if (shape.type === "frame" || shape.parentId !== currentPageId) continue;

        const bounds = this.editor.getShapePageBounds(shape.id);
        if (!bounds) continue;

        // Binary search: find the last page whose y <= shape center y.
        let lo = 0;
        let hi = pages.length - 1;
        let matchIdx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1;
          if (pages[mid].y <= bounds.center.y) {
            matchIdx = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }

        const deltaY = matchIdx >= 0 ? (pageDeltas.get(pages[matchIdx].id) ?? 0) : 0;
        if (Math.abs(deltaY) < 0.5) continue;

        looseUpdates.push({
          id: shape.id,
          type: shape.type,
          y: shape.y + deltaY,
        });
      }

      if (frameUpdates.length > 0) {
        this.editor.updateShapes(frameUpdates);
      }
      if (looseUpdates.length > 0) {
        this.editor.updateShapes(looseUpdates);
      }

      this.renumberPages();
    });
  }

  private renumberPages() {
    const pages = this.getPages();
    const updates: { id: TLShapeId; type: "frame"; props: { name: string } }[] =
      [];

    for (let i = 0; i < pages.length; i++) {
      const frame = this.editor.getShape(pages[i].id);
      if (!frame || frame.type !== "frame") continue;
      const expected = `Page ${i + 1}`;
      if ((frame as TLFrameShape).props.name !== expected) {
        updates.push({
          id: pages[i].id,
          type: "frame",
          props: { name: expected },
        });
      }
    }

    if (updates.length > 0) {
      this.editor.updateShapes(updates);
    }
  }

}
