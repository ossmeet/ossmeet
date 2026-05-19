import { Box, type Editor } from "tldraw";
import { WHITEBOARD_CONFIG } from "./constants";
import type { WhiteboardPage } from "./page-manager";
import { isNearFitWidthZoom } from "./pull-to-add";

const { PAGE_WIDTH, PAGE_HEIGHT, PAGE_SPACING, CAMERA_PADDING } = WHITEBOARD_CONFIG;
const MIN_FIT_ZOOM = 0.05;
const MAX_FIT_ZOOM = 4;

export interface CameraDimensions {
  pageWidth: number;
  pageHeight: number;
  pageSpacing: number;
  cameraPadding: number;
}

export class CameraConstraints {
  private dimensions: CameraDimensions;
  private _canAutoCreate = false;

  constructor(
    private editor: Editor,
    dimensions?: CameraDimensions
  ) {
    this.dimensions = dimensions ?? {
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
      pageSpacing: PAGE_SPACING,
      cameraPadding: CAMERA_PADDING,
    };
  }

  updateDimensions(dimensions: CameraDimensions) {
    this.dimensions = dimensions;
  }

  getDimensions(): CameraDimensions {
    return this.dimensions;
  }

  setCanAutoCreate(value: boolean) {
    this._canAutoCreate = value;
  }

  private getFullDocumentBounds(
    pages: WhiteboardPage[],
    canAutoCreate: boolean
  ): Box {
    if (pages.length === 0) {
      return new Box(
        0,
        0,
        this.dimensions.pageWidth,
        this.dimensions.pageHeight
      );
    }

    const firstPageY = pages[0].y;
    const lastPage = pages[pages.length - 1];
    const lastPageBottom = lastPage.y + lastPage.height;
    const trailingBuffer = canAutoCreate
      ? lastPage.height + this.dimensions.pageSpacing
      : 0;
    const totalHeight = lastPageBottom - firstPageY + trailingBuffer;

    return new Box(0, firstPageY, this.dimensions.pageWidth, totalHeight);
  }

  update(pages: WhiteboardPage[], _pageNumber: number) {
    const bounds = this.getFullDocumentBounds(pages, this._canAutoCreate);
    this.editor.setCameraOptions({
      constraints: {
        bounds,
        padding: {
          x: this.dimensions.cameraPadding,
          y: this.dimensions.cameraPadding,
        },
        origin: { x: 0.5, y: 0.5 },
        initialZoom: "fit-x",
        baseZoom: "fit-x",
        behavior: { x: "fixed", y: "inside" },
      },
      wheelBehavior: "pan",
      zoomSteps: [0.5, 0.75, 1, 1.5, 2, 3, 4],
    });
  }

  getFillWidthZoom(): number {
    const viewportWidth = this.editor.getViewportScreenBounds().width;
    const paddedViewportWidth = Math.max(
      1,
      viewportWidth - this.dimensions.cameraPadding * 2
    );
    const fitZoom = paddedViewportWidth / this.dimensions.pageWidth;
    if (!Number.isFinite(fitZoom)) return 1;
    return Math.min(MAX_FIT_ZOOM, Math.max(MIN_FIT_ZOOM, fitZoom));
  }

  setCameraToPage(
    pages: WhiteboardPage[],
    pageNumber: number,
    animated: boolean
  ) {
    const zoom = this.getFillWidthZoom();
    const viewport = this.editor.getViewportScreenBounds();
    const inset = this.dimensions.cameraPadding / zoom;

    const safePageNumber = Math.max(1, pageNumber);
    const targetPage = pages[safePageNumber - 1];
    const pageY =
      targetPage?.y ??
      (safePageNumber - 1) *
        (this.dimensions.pageHeight + this.dimensions.pageSpacing);
    const pageHeight = targetPage?.height ?? this.dimensions.pageHeight;

    const x = inset;
    const pageScreenHeight = pageHeight * zoom;
    const viewportHeight = Math.max(
      1,
      viewport.height - this.dimensions.cameraPadding * 2
    );
    const y =
      pageScreenHeight <= viewportHeight
        ? -(pageY - (inset + (viewportHeight - pageScreenHeight) / (2 * zoom)))
        : -(pageY - inset);

    this.editor.setCamera(
      { x, y, z: zoom },
      animated ? { animation: { duration: 220 }, force: true } : { force: true }
    );
  }

  zoomToPage(
    pages: WhiteboardPage[],
    pageNumber: number,
    animated = true
  ) {
    this.update(pages, pageNumber);
    this.setCameraToPage(pages, pageNumber, animated);
  }

  isNearFitXZoom(): boolean {
    const fitX = this.getFillWidthZoom();
    const current = this.editor.getCamera().z;
    return isNearFitWidthZoom(current, fitX);
  }

  forceToPage(pages: WhiteboardPage[], pageNumber: number) {
    this.update(pages, pageNumber);
    this.setCameraToPage(pages, pageNumber, false);
  }
}
