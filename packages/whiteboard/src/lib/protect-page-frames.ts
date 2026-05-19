import type { Editor, TLShape, TLFrameShape } from "tldraw";

const pageFrameMutationAllowanceDepth = new WeakMap<Editor, number>();

/**
 * Temporarily allow controlled page-frame mutations/deletions from internal
 * whiteboard logic (e.g. insert / renumber / PDF import cleanup) while keeping
 * direct user edits blocked.
 */
export function withPageFrameMutationAllowance<T>(editor: Editor, fn: () => T): T {
  const currentDepth = pageFrameMutationAllowanceDepth.get(editor) ?? 0;
  pageFrameMutationAllowanceDepth.set(editor, currentDepth + 1);
  try {
    return fn();
  } finally {
    const nextDepth = (pageFrameMutationAllowanceDepth.get(editor) ?? 1) - 1;
    if (nextDepth <= 0) {
      pageFrameMutationAllowanceDepth.delete(editor);
    } else {
      pageFrameMutationAllowanceDepth.set(editor, nextDepth);
    }
  }
}

function hasPageFrameMutationAllowance(editor: Editor): boolean {
  return (pageFrameMutationAllowanceDepth.get(editor) ?? 0) > 0;
}

function isPageFrame(shape: TLShape): shape is TLFrameShape {
  // use meta.isPageFrame flag set by PageManager for reliable detection
  return (
    shape.type === "frame" &&
    (shape.meta as Record<string, unknown> | undefined)?.isPageFrame === true
  );
}

/**
 * Registers side effects to protect page frames from being deleted, moved,
 * or resized by users. Replaces isLocked which also blocked the eraser on children.
 *
 * By default, blocks deletes and mutations from all sources (including API/AI).
 * Trusted internal page operations can opt in to temporary mutation allowance.
 */
export function registerPageFrameProtection(editor: Editor): () => void {
  const unregisterDelete = editor.sideEffects.registerBeforeDeleteHandler(
    "shape",
    (shape) => {
      // Block page frame deletion unless explicitly allowed by trusted logic.
      if (isPageFrame(shape) && !hasPageFrameMutationAllowance(editor)) {
        return false;
      }
      return;
    }
  );

  const unregisterChange = editor.sideEffects.registerBeforeChangeHandler(
    "shape",
    (prev, next, source) => {
      // Only lock geometry/name for direct user-initiated changes.
      // Internal page operations can opt in via withPageFrameMutationAllowance().
      if (source !== "user" || hasPageFrameMutationAllowance(editor)) return next;
      if (!isPageFrame(next)) return next;

      const prevFrame = prev as TLFrameShape;

      return {
        ...next,
        x: prevFrame.x,
        y: prevFrame.y,
        rotation: prevFrame.rotation,
        props: {
          ...(next as TLFrameShape).props,
          w: prevFrame.props.w,
          h: prevFrame.props.h,
          name: prevFrame.props.name,
        },
      } as typeof next;
    }
  );

  return () => {
    unregisterDelete();
    unregisterChange();
  };
}
