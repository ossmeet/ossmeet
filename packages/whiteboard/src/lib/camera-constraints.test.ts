import { describe, expect, it, vi } from "vitest";
import type { Editor } from "tldraw";
import { CameraConstraints } from "./camera-constraints";

function createEditorMock(width: number, height: number) {
  let camera = { x: 0, y: 0, z: 1 };
  const editor = {
    getViewportScreenBounds: vi.fn(() => ({ x: 0, y: 0, width, height, w: width, h: height })),
    getCamera: vi.fn(() => camera),
    pageToScreen: vi.fn((point: { x: number; y: number }) => ({
      x: (point.x + camera.x) * camera.z,
      y: (point.y + camera.y) * camera.z,
    })),
    setCameraOptions: vi.fn(),
    setCamera: vi.fn((nextCamera: typeof camera) => {
      camera = nextCamera;
    }),
  } as unknown as Editor & {
    setCamera: ReturnType<typeof vi.fn>;
  };
  return editor;
}

describe("CameraConstraints", () => {
  it("places the first page near the top after the meeting chrome", () => {
    const editor = createEditorMock(1600, 900);
    const constraints = new CameraConstraints(editor, {
      pageWidth: 1200,
      pageHeight: 900,
      pageSpacing: 100,
      cameraPadding: 40,
    });

    constraints.setCameraToPage(
      [{ id: "shape:page-1" as never, number: 1, y: 0, height: 900 }],
      1,
      false,
    );

    expect(editor.setCamera).toHaveBeenCalledWith(
      expect.objectContaining({
        x: expect.closeTo(31.58, 2),
        y: expect.closeTo(31.58, 2),
        z: expect.closeTo(1.27, 2),
      }),
      { force: true },
    );
  });

  it("uses a compact top inset for short landscape viewports", () => {
    const editor = createEditorMock(900, 480);
    const constraints = new CameraConstraints(editor, {
      pageWidth: 1200,
      pageHeight: 900,
      pageSpacing: 100,
      cameraPadding: 24,
    });

    constraints.setCameraToPage(
      [{ id: "shape:page-1" as never, number: 1, y: 0, height: 900 }],
      1,
      false,
    );

    expect(editor.setCamera).toHaveBeenCalledWith(
      expect.objectContaining({
        y: expect.closeTo(33.80, 2),
        z: expect.closeTo(0.71, 2),
      }),
      { force: true },
    );
  });

  it("bounds the camera to the current document", () => {
    const editor = createEditorMock(1600, 900);
    const constraints = new CameraConstraints(editor);

    constraints.update(
      [{ id: "shape:page-1" as never, number: 1, y: 0, height: 900 }],
      1,
    );

    expect(editor.setCameraOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({
          bounds: expect.objectContaining({
            x: 0,
            y: 0,
            w: 1200,
            h: 900,
          }),
          behavior: { x: "fixed", y: "inside" },
          initialZoom: "fit-x",
          baseZoom: "fit-x",
        }),
        wheelBehavior: "pan",
      }),
    );
  });

  it("adds a trailing buffer only for canvas editors who can pull to add pages", () => {
    const editor = createEditorMock(1600, 900);
    const constraints = new CameraConstraints(editor, {
      pageWidth: 1200,
      pageHeight: 900,
      pageSpacing: 100,
      cameraPadding: 40,
    });

    constraints.setCanAutoCreate(true);
    constraints.update(
      [{ id: "shape:page-1" as never, number: 1, y: 0, height: 900 }],
      1,
    );

    expect(editor.setCameraOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({
          bounds: expect.objectContaining({
            h: 1900,
          }),
        }),
      }),
    );
  });
});
