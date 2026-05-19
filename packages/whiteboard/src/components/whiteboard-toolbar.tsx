import {
  useRef,
  useState,
  useEffect,
  useCallback,
  createContext,
} from "react";
import type { ImageImportPhase } from "../lib/import-image";
import { screenshotBrushAtom } from "../lib/screenshot-tool";
import {
  DefaultColorStyle,
  DefaultFillStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
  useEditor,
  useActions,
  useValue,
  useToasts,
  useCanUndo,
  useCanRedo,
  track,
} from "tldraw";
import type { TLDefaultColorStyle, TLDefaultFillStyle, TLDefaultDashStyle, TLDefaultSizeStyle } from "tldraw";
import {
  Image,
  ClipboardPaste,
  FileText,
  Loader2,
  BotMessageSquare,
  X,
  Plus,
  Trash2,
  Undo2,
  Redo2,
  Copy,
  LayoutGrid,
  PencilOff,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  PAGE_BACKGROUND_OPTIONS,
  getBackgroundStyle,
  parsePageBackground,
  type PageBackground,
} from "../lib/page-background";
import { WHITEBOARD_IMAGE_ACCEPT_ATTR } from "../lib/whiteboard-image";
import { WHITEBOARD_IMPORT_ERROR_EVENT } from "../lib/import-error-event";
import {
  DEFAULT_TABLE_COLS,
  DEFAULT_TABLE_HEIGHT,
  DEFAULT_TABLE_ROWS,
  DEFAULT_TABLE_WIDTH,
  TABLE_SHAPE_TYPE,
} from "../lib/table-shape-schema";
import { createShapeId, type TLParentId } from "tldraw";
export {
  WhiteboardToolbarContext,
  getEditorActions,
  setImageInputRef,
  setPasteHandler,
  setPdfInputRef,
  useWhiteboardToolbarContext,
} from "./whiteboard-toolbar-context";
import { GeoToolIcon, ToolIcon } from "./whiteboard-toolbar-icons";
import {
  getEditorActions,
  setImageInputRef,
  setPasteHandler,
  setPdfInputRef,
  useWhiteboardToolbarContext,
} from "./whiteboard-toolbar-context";

type ToolbarPanel = "insert" | "background" | "properties";

const STYLEABLE_TOOL_IDS = new Set(["draw", "highlight", "text", "arrow", "geo"]);
const DEFAULT_HIGHLIGHT_COLOR: TLDefaultColorStyle = "yellow";

function getNextShapeColor(editor: ReturnType<typeof useEditor>) {
  return editor.getInstanceState().stylesForNextShape[
    DefaultColorStyle.id
  ] as TLDefaultColorStyle | undefined;
}

interface ToolColorContextValue {
  currentToolId: string;
  highlightColor: TLDefaultColorStyle | null;
  setToolColor: (value: TLDefaultColorStyle) => void;
}

const ToolColorContext = createContext<ToolColorContextValue | null>(null);

function toggleEraserId(currentEraserId: string) {
  return currentEraserId === "eraser" ? "stroke-eraser" : "eraser";
}

function getEraserModeLabel(currentToolId: string) {
  return currentToolId === "stroke-eraser" ? "Eraser: Stroke" : "Eraser: Standard";
}



// ─── Unified compact toolbar ─────────────────────────────────────────────────

/**
 * Vertical toolbar attached to the left edge of the current page frame.
 * Uses editor.pageToViewport() to track the page position so it moves
 * naturally with zoom/pan.
 */
export const WhiteboardToolbar = track(function WhiteboardToolbar() {
  const editor = useEditor();
  const currentToolId = useValue(
    "current tool",
    () => editor.getCurrentToolId(),
    [editor]
  );
  const {
    pages,
    canEditCanvas,
    isPhone,
    aiEnabled,
    onToggleAi,
    isAiPanelOpen,
    isLoading,
    isConnected,
  } = useWhiteboardToolbarContext();

  const toolbarRef = useRef<HTMLDivElement>(null);
  const [highlightColor, setHighlightColor] =
    useState<TLDefaultColorStyle | null>(DEFAULT_HIGHLIGHT_COLOR);
  const [nonHighlightColor, setNonHighlightColor] =
    useState<TLDefaultColorStyle>("black");
  const [openPanel, setOpenPanel] = useState<ToolbarPanel | null>(null);
  const [preferredEraserId, setPreferredEraserId] = useState<"eraser" | "stroke-eraser">("eraser");

  const nextShapeColor = useValue(
    "next shape color",
    () => getNextShapeColor(editor),
    [editor]
  );

  useEffect(() => {
    if (!nextShapeColor) return;

    if (currentToolId === "highlight") {
      setHighlightColor(nextShapeColor);
      return;
    }

    if (STYLEABLE_TOOL_IDS.has(currentToolId)) {
      setNonHighlightColor(nextShapeColor);
    }
  }, [currentToolId, nextShapeColor]);

  const setToolColor = useCallback(
    (value: TLDefaultColorStyle) => {
      if (currentToolId === "highlight") {
        setHighlightColor(value);
      } else {
        setNonHighlightColor(value);
      }

      editor.setStyleForNextShapes(DefaultColorStyle, value);
      editor.setStyleForSelectedShapes(DefaultColorStyle, value);
    },
    [currentToolId, editor]
  );

  const handleToolSelect = useCallback(
    (toolId: string) => {
      if (toolId === "eraser") {
        const isOnEraser = currentToolId === "eraser" || currentToolId === "stroke-eraser";
        const nextId = isOnEraser ? toggleEraserId(currentToolId) : preferredEraserId;
        setPreferredEraserId(nextId);
        editor.setCurrentTool(nextId);
        setOpenPanel(null);
        return;
      }

      if (toolId === "table") {
        setOpenPanel(null);
        createTableAtViewportCenter(editor);
        return;
      }

      const currentColor = getNextShapeColor(editor);

      if (currentToolId === "highlight" && toolId !== "highlight") {
        if (currentColor) {
          setHighlightColor(currentColor);
        }
      }

      if (currentToolId !== "highlight" && toolId === "highlight") {
        if (currentColor) {
          setNonHighlightColor(currentColor);
        }
      }

      if (toolId === "highlight") {
        const nextHighlightColor = highlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
        setHighlightColor(nextHighlightColor);
        editor.setStyleForNextShapes(DefaultColorStyle, nextHighlightColor);
      } else if (STYLEABLE_TOOL_IDS.has(toolId)) {
        editor.setStyleForNextShapes(DefaultColorStyle, nonHighlightColor);
      }

      editor.setCurrentTool(toolId);
      setOpenPanel(null);
    },
    [currentToolId, editor, highlightColor, nonHighlightColor, preferredEraserId]
  );

  const handlePanelToggle = useCallback(
    (panel: ToolbarPanel) => {
      const willOpen = openPanel !== panel;
      setOpenPanel(willOpen ? panel : null);
      if (willOpen && isAiPanelOpen && onToggleAi) {
        onToggleAi();
      }
    },
    [openPanel, isAiPanelOpen, onToggleAi]
  );

  const closePanels = useCallback(() => {
    setOpenPanel(null);
  }, []);

  const currentGeoType = useValue(
    "current geo type",
    () => (editor.getInstanceState().stylesForNextShape[GeoShapeGeoStyle.id] as string) ?? "rectangle",
    [editor]
  );

  const handleGeoToolSelect = useCallback(
    (geoType: string) => {
      if (currentToolId === "highlight") {
        editor.setStyleForNextShapes(DefaultColorStyle, nonHighlightColor);
      }
      editor.setStyleForNextShapes(GeoShapeGeoStyle, geoType as any);
      editor.setCurrentTool("geo");
      setOpenPanel(null);
    },
    [currentToolId, editor, nonHighlightColor]
  );

  const actions = useActions();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  return (
    <ToolColorContext.Provider
      value={{
        currentToolId,
        highlightColor,
        setToolColor,
      }}
    >
      <>
      <div
        ref={toolbarRef}
        className={cn(
          "absolute left-1/2 -translate-x-1/2 z-[200] pointer-events-auto transition-all duration-300 ease-in-out",
          isPhone ? "w-[calc(100%-0.75rem)] max-w-[calc(100vw-0.75rem)]" : "top-6"
        )}
        style={
          isPhone
            ? { bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" }
            : undefined
        }
      >
        <div
          className={cn(
            "bg-white/80 backdrop-blur-2xl border border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.12)] flex items-center transition-all duration-500",
            isPhone
              ? "gap-0.5 px-1.5 py-1.5 rounded-2xl overflow-x-auto no-scrollbar"
              : "gap-1 px-2 py-1.5 rounded-full"
          )}
        >
        {/* Group 1: Sync Status */}
        <div
          className={cn(
            "flex items-center gap-1 shrink-0",
            isPhone
              ? "px-1"
              : "px-1.5 border-r border-stone-200/60"
          )}
        >
          <div
            className={cn(
              "h-2 w-2 rounded-full shrink-0",
              isLoading ? "bg-yellow-400 animate-pulse" : isConnected ? "bg-green-500" : "bg-gray-400"
            )}
          />
          {!isPhone && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
              {isLoading ? "Syncing" : isConnected ? "Live" : "Offline"}
            </span>
          )}
        </div>

        {isPhone && <div className="w-px h-5 bg-stone-200/40 shrink-0" />}

        {/* Group 2: History */}
        {canEditCanvas && (
          <div className={cn("flex items-center shrink-0", !isPhone && "border-r border-stone-200/60")}>
            <IslandActionButton onClick={() => actions["undo"]?.onSelect("toolbar")} disabled={!canUndo} label="Undo" compact={isPhone}>
              <Undo2 className={cn(isPhone ? "w-3.5 h-3.5" : "w-4 h-4")} />
            </IslandActionButton>
            <IslandActionButton onClick={() => actions["redo"]?.onSelect("toolbar")} disabled={!canRedo} label="Redo" compact={isPhone}>
              <Redo2 className={cn(isPhone ? "w-3.5 h-3.5" : "w-4 h-4")} />
            </IslandActionButton>
          </div>
        )}

        {isPhone && <div className="w-px h-5 bg-stone-200/40 shrink-0" />}

        {/* Group 3: Core Tools Cluster */}
        <div className="flex items-center gap-0.5 shrink-0">
          <ToolButton id="select" current={currentToolId} onSelect={handleToolSelect} label="Select" compact={isPhone} />
          <ToolButton id="draw" current={currentToolId} onSelect={handleToolSelect} label="Draw" compact={isPhone} />
          <ToolButton id="highlight" current={currentToolId} onSelect={handleToolSelect} label="Highlighter" compact={isPhone} />
          <ToolButton
            id="eraser"
            current={currentToolId}
            onSelect={handleToolSelect}
            label={getEraserModeLabel(currentToolId)}
            compact={isPhone}
          />
          <ToolButton id="text" current={currentToolId} onSelect={handleToolSelect} label="Text" compact={isPhone} />
          <ToolButton id="arrow" current={currentToolId} onSelect={handleToolSelect} label="Arrow" compact={isPhone} />
          {!isPhone && <ToolButton id="laser" current={currentToolId} onSelect={handleToolSelect} label="Laser" />}
          {!isPhone && <ToolButton id="screenshot" current={currentToolId} onSelect={handleToolSelect} label="Snip to image" />}
          <div className="w-px h-5 bg-stone-200/60 mx-0.5 shrink-0" />
          <GeoToolButton geoType="rectangle" currentToolId={currentToolId} currentGeoType={currentGeoType} onSelect={handleGeoToolSelect} label="Rectangle" compact={isPhone} />
          {!isPhone && <GeoToolButton geoType="ellipse" currentToolId={currentToolId} currentGeoType={currentGeoType} onSelect={handleGeoToolSelect} label="Ellipse" />}
          {!isPhone && <GeoToolButton geoType="diamond" currentToolId={currentToolId} currentGeoType={currentGeoType} onSelect={handleGeoToolSelect} label="Diamond" />}
          <ToolButton id="table" current={currentToolId} onSelect={handleToolSelect} label="Table" compact={isPhone} />
        </div>

        {!isPhone && <Separator />}
        {isPhone && <div className="w-px h-5 bg-stone-200/40 shrink-0" />}

        {/* Group 5: Actions & Intelligence */}
        <div className="flex items-center gap-0.5 shrink-0">
          <InsertMenuDropdown
            isOpen={openPanel === "insert"}
            onToggle={() => handlePanelToggle("insert")}
            onClose={closePanels}
          />
          <PropertiesPanelToggle
            isOpen={openPanel === "properties"}
            onToggle={() => handlePanelToggle("properties")}
            onClose={closePanels}
          />
          {canEditCanvas && pages.length > 0 && (
            <BackgroundPanelToggle
              isOpen={openPanel === "background"}
              onToggle={() => handlePanelToggle("background")}
              onClose={closePanels}
            />
          )}

          {aiEnabled && onToggleAi && (
            <button
              type="button"
              onClick={() => {
                closePanels();
                onToggleAi();
              }}
              className={cn(
                "group relative flex items-center gap-1 h-8 rounded-full transition-all border shrink-0 text-xs font-medium",
                isPhone ? "w-8 justify-center" : "px-2.5 h-9",
                isAiPanelOpen
                  ? "bg-violet-100 text-violet-700 border-violet-300 shadow-inner"
                  : "bg-gradient-to-tr from-violet-50 to-purple-50 text-violet-600 border-violet-200 hover:from-violet-100 hover:to-purple-100"
              )}
            >
              <BotMessageSquare className={cn(isPhone ? "w-3.5 h-3.5" : "w-4 h-4")} />
              {!isPhone && <span className="hidden sm:inline">AI</span>}
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-stone-900 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                AI Assistant
              </div>
            </button>
          )}
        </div>
        </div>
      </div>
      </>
    </ToolColorContext.Provider>
  );
});

// ─── Table creation helper ───────────────────────────────────────────────────

function createTableAtViewportCenter(editor: ReturnType<typeof useEditor>) {
  const w = DEFAULT_TABLE_WIDTH;
  const h = DEFAULT_TABLE_HEIGHT;
  const center = editor.getViewportPageBounds().center;

  // Parent the table to whichever page frame contains the viewport center.
  let parentId: TLParentId = editor.getCurrentPageId();
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== "frame") continue;
    const fb = editor.getShapePageBounds(shape);
    if (fb?.containsPoint(center)) {
      parentId = shape.id as TLParentId;
      break;
    }
  }

  let x = center.x - w / 2;
  let y = center.y - h / 2;
  if (parentId !== editor.getCurrentPageId()) {
    const parentShape = editor.getShape(parentId);
    if (parentShape) {
      x -= parentShape.x;
      y -= parentShape.y;
    }
  }

  const id = createShapeId();
  editor.createShape({
    id,
    type: TABLE_SHAPE_TYPE,
    parentId,
    x,
    y,
    props: {
      w,
      h,
      rows: DEFAULT_TABLE_ROWS,
      cols: DEFAULT_TABLE_COLS,
      headerRow: true,
      cells: Array.from({ length: DEFAULT_TABLE_ROWS }, () =>
        Array.from({ length: DEFAULT_TABLE_COLS }, () => "")
      ),
    },
  });

  editor.setCurrentTool("select");
  editor.setSelectedShapes([id]);
  // Defer entering edit mode until after the shape mounts so the cell
  // input can receive focus reliably.
  queueMicrotask(() => {
    if (editor.getShape(id)) editor.setEditingShape(id);
  });
}

// ─── Tool button (44px touch target) ─────────────────────────────────────────

function ToolButton({
  id,
  current,
  onSelect,
  label,
  compact,
}: {
  id: string;
  current: string;
  onSelect: (id: string) => void;
  label: string;
  compact?: boolean;
}) {
  const isActive =
    current === id || (id === "eraser" && current === "stroke-eraser");
  const isStrokeEraser = id === "eraser" && current === "stroke-eraser";
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={cn(
        "relative rounded-full flex items-center justify-center transition-all shrink-0",
        compact ? "w-8 h-8" : "w-9 h-9",
        isActive
          ? "bg-[#23295a] text-white shadow-lg scale-110"
          : "text-stone-600 hover:bg-stone-100 active:bg-stone-200"
      )}
      title={label}
      aria-label={label}
      aria-pressed={isActive}
    >
      <ToolIcon toolId={id} compact={true} isStrokeEraser={isStrokeEraser} />
      {isStrokeEraser && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-white" />
      )}
    </button>
  );
}

// ─── Geo Tool Button ─────────────────────────────────────────────────────────

function GeoToolButton({
  geoType,
  currentToolId,
  currentGeoType,
  onSelect,
  label,
  compact,
}: {
  geoType: string;
  currentToolId: string;
  currentGeoType: string;
  onSelect: (geoType: string) => void;
  label: string;
  compact?: boolean;
}) {
  const isActive = currentToolId === "geo" && currentGeoType === geoType;
  return (
    <button
      type="button"
      onClick={() => onSelect(geoType)}
      className={cn(
        "rounded-full flex items-center justify-center transition-all shrink-0",
        compact ? "w-8 h-8" : "w-9 h-9",
        isActive
          ? "bg-[#23295a] text-white shadow-lg scale-110"
          : "text-stone-600 hover:bg-stone-100 active:bg-stone-200"
      )}
      title={label}
      aria-label={label}
      aria-pressed={isActive}
    >
      <GeoToolIcon geoType={geoType} />
    </button>
  );
}

function IslandActionButton({
  onClick,
  disabled,
  label,
  children,
  variant = "default",
  compact,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
  variant?: "default" | "danger";
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:pointer-events-none shrink-0",
        compact ? "w-7 h-7" : "w-8 h-8",
        variant === "danger"
          ? "text-red-500 hover:bg-red-50"
          : "text-stone-500 hover:bg-stone-100"
      )}
      title={label}
    >
      {children}
    </button>
  );
}

function Separator() {
  return (
    <div className="w-px h-6 bg-stone-200/60 mx-1 shrink-0" />
  );
}

interface ToolbarPopoverProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function InsertMenuDropdown({ isOpen, onToggle, onClose }: ToolbarPopoverProps) {
  const { pageManager, uploadFile, isPhone } = useWhiteboardToolbarContext();
  const editor = useEditor();
  const actions = useActions();
  const rootRef = useRef<HTMLDivElement>(null);
  // use per-editor registry instead of module-level globals
  const editorActions = getEditorActions(editor);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!pageManager) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center transition-all",
          isOpen ? "bg-stone-100 text-stone-900 shadow-inner" : "text-stone-600 hover:bg-stone-100"
        )}
        title="Add objects"
      >
        <Plus className={cn("w-5 h-5 transition-transform duration-300", isOpen && "rotate-45")} />
      </button>

      {isOpen && (
        <div
          className={cn(
            "absolute z-[410] w-56 bg-white rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.15)] border border-stone-200/80 p-1.5 animate-in fade-in zoom-in duration-200",
            isPhone ? "bottom-full left-1/2 mb-3 -translate-x-1/2" : "left-1/2 top-full mt-3 -translate-x-1/2"
          )}
          style={{
            transformOrigin: "top center",
          }}
        >
          <DropdownItem icon={<ClipboardPaste className="w-4 h-4"/>} label="Paste from clipboard" onClick={() => { editorActions.pasteHandler?.(); onClose(); }} />
          {uploadFile && (
            <>
              <DropdownItem icon={<Image className="w-4 h-4"/>} label="Insert Image" onClick={() => { editorActions.imageInputRef.current?.click(); onClose(); }} />
              <DropdownItem icon={<FileText className="w-4 h-4"/>} label="Import PDF" onClick={() => { editorActions.pdfInputRef.current?.click(); onClose(); }} />
            </>
          )}
          <div className="h-px bg-stone-100 my-1 mx-2" />
          <DropdownItem icon={<Copy className="w-4 h-4"/>} label="Duplicate Selection" onClick={() => { actions["duplicate"]?.onSelect("toolbar"); onClose(); }} />
          <DropdownItem icon={<Trash2 className="w-4 h-4 text-red-500"/>} label="Delete Selection" onClick={() => { actions["delete"]?.onSelect("toolbar"); onClose(); }} variant="danger" />
        </div>
      )}
    </div>
  );
}

// ─── Properties panel toggle (Excalidraw-style flyout) ───────────────────────

const COLOR_MAP: Record<TLDefaultColorStyle, string> = {
  black: '#1d1d1d', grey: '#808080', 'light-violet': '#c4a3e5',
  violet: '#9e52d9', blue: '#1d90e0', 'light-blue': '#6eb3d9',
  yellow: '#e0c432', orange: '#e08e32', green: '#46a346',
  'light-green': '#78c06e', 'light-red': '#e88a8a', red: '#e05252',
  white: '#ffffff',
};

const PropertiesPanelToggle = track(function PropertiesPanelToggle({
  isOpen,
  onToggle,
  onClose,
}: ToolbarPopoverProps) {
  const editor = useEditor();
  const { isPhone } = useWhiteboardToolbarContext();
  const rootRef = useRef<HTMLDivElement>(null);

  const currentColor = useValue('propertiesColor', () => {
    const shared = editor.getSharedStyles().get(DefaultColorStyle);
    if (shared?.type === 'shared') return shared.value;
    return (editor.getInstanceState().stylesForNextShape[DefaultColorStyle.id] as TLDefaultColorStyle) ?? 'black';
  }, [editor]);

  const hasSelected = useValue('hasSelected', () => editor.getSelectedShapes().length > 0, [editor]);
  const actions = useActions();

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, onClose]);

  const dotColor = COLOR_MAP[currentColor] ?? '#1d1d1d';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center transition-all gap-1",
          isOpen
            ? "bg-[#23295a] text-white shadow-lg scale-110"
            : "text-stone-600 hover:bg-stone-100 active:bg-stone-200"
        )}
        title="Properties"
        aria-label="Properties"
      >
        {/* Two stacked dots: stroke color + fill indicator */}
        <svg width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="6" fill="none" stroke={isOpen ? 'white' : dotColor} strokeWidth="2.5" />
          <circle cx="8" cy="8" r="3" fill={isOpen ? 'white' : dotColor} />
        </svg>
      </button>

      {isOpen && (
        <div
          className={cn(
            "absolute z-[410] bg-white rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.15)] border border-stone-200/80 overflow-hidden animate-in fade-in zoom-in duration-150",
            isPhone
              ? "bottom-full right-0 mb-3 w-[min(90vw,260px)]"
              : "right-0 top-full mt-3 w-[240px]"
          )}
          style={{ transformOrigin: 'top right' }}
        >
          <div className="px-3.5 py-2.5 border-b border-stone-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-700">Properties</span>
          </div>
          <div className="p-3 space-y-3">

            {/* Stroke color */}
            <PropertiesSection label="Stroke">
              <div className="flex flex-wrap gap-1.5">
                {(['black','red','blue','green','yellow','orange','violet','grey','light-blue','light-green'] as TLDefaultColorStyle[]).map(c => (
                  <PanelColorSwatch key={c} value={c} />
                ))}
              </div>
            </PropertiesSection>

            <div className="border-t border-stone-100" />

            {/* Fill */}
            <PropertiesSection label="Fill">
              <div className="flex gap-1">
                <FillOption value="none" label="None" />
                <FillOption value="semi" label="Semi" />
                <FillOption value="solid" label="Solid" />
              </div>
            </PropertiesSection>

            <div className="border-t border-stone-100" />

            <div className="grid grid-cols-2 gap-3">
              {/* Stroke style */}
              <PropertiesSection label="Style">
                <div className="flex gap-1">
                  <DashOption value="draw" />
                  <DashOption value="dashed" />
                  <DashOption value="dotted" />
                </div>
              </PropertiesSection>

              {/* Stroke width */}
              <PropertiesSection label="Width">
                <div className="flex gap-1">
                  <SizeOption value="s" />
                  <SizeOption value="m" />
                  <SizeOption value="l" />
                  <SizeOption value="xl" />
                </div>
              </PropertiesSection>
            </div>

            <div className="border-t border-stone-100" />

            {/* Opacity */}
            <PropertiesSection label="Opacity">
              <OpacitySlider />
            </PropertiesSection>

            {/* Layers — only when shapes selected */}
            {hasSelected && (
              <>
                <div className="border-t border-stone-100" />
                <PropertiesSection label="Layers">
                  <div className="flex gap-1">
                    {[
                      { id: 'send-to-back', title: 'Send to back', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 11 12 6 7 11" /><polyline points="17 18 12 13 7 18" /></svg> },
                      { id: 'send-backward', title: 'Send backward', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 15 12 10 7 15" /></svg> },
                      { id: 'bring-forward', title: 'Bring forward', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 9 12 14 7 9" /></svg> },
                      { id: 'bring-to-front', title: 'Bring to front', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 6 12 11 7 6" /><polyline points="17 13 12 18 7 13" /></svg> },
                    ].map(({ id, title, icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => actions[id]?.onSelect('toolbar')}
                        className="flex-1 h-7 rounded-lg flex items-center justify-center bg-stone-100 text-stone-700 hover:bg-stone-200 transition-all border border-transparent hover:border-stone-300"
                        title={title}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </PropertiesSection>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

function DropdownItem({ icon, label, onClick, variant = "default" }: { icon: React.ReactNode, label: string, onClick: () => void, variant?: "default" | "danger" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors",
        variant === "danger" ? "text-red-600 hover:bg-red-50" : "text-stone-700 hover:bg-stone-100"
      )}
    >
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", variant === "danger" ? "bg-red-50" : "bg-stone-50")}>
        {icon}
      </div>
      <span className="truncate">{label}</span>
    </button>
  );
}

function OpacitySlider() {
  const editor = useEditor();
  const opacity = useValue('opacity', () => {
    const shared = editor.getSharedOpacity();
    if (shared.type === 'shared') return shared.value;
    return editor.getInstanceState().opacityForNextShape;
  }, [editor]);

  const opacities = [
    { value: 0.1, label: '10%' },
    { value: 0.25, label: '25%' },
    { value: 0.5, label: '50%' },
    { value: 0.75, label: '75%' },
    { value: 1, label: '100%' },
  ];

  return (
    <div className="flex gap-1.5">
      {opacities.map((op) => (
        <button
          key={op.value}
          type="button"
          onClick={() => {
            editor.setOpacityForNextShapes(op.value);
            editor.setOpacityForSelectedShapes(op.value);
          }}
          className={cn(
            "flex-1 h-7 rounded-md text-[10px] font-medium transition-all border",
            Math.abs(opacity - op.value) < 0.01
              ? "bg-[#23295a] text-white shadow-sm border-[#23295a]"
              : "bg-stone-100 text-stone-700 hover:bg-stone-200 border-transparent hover:border-stone-300"
          )}
          title={op.label}
        >
          {op.value * 100}%
        </button>
      ))}
    </div>
  );
}

function FillOption({ value, label }: { value: TLDefaultFillStyle; label: string }) {
  const editor = useEditor();
  const sharedFill = useValue('sharedFill', () => {
    const shared = editor.getSharedStyles().get(DefaultFillStyle);
    if (shared?.type === 'shared') return shared.value;
    // Fall back to next-shape style
    return editor.getInstanceState().stylesForNextShape[DefaultFillStyle.id] as TLDefaultFillStyle | undefined;
  }, [editor]);
  const isActive = sharedFill === value;

  const fills: Record<string, React.ReactNode> = {
    none: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="12" height="12" rx="2" strokeDasharray="2 2" />
      </svg>
    ),
    semi: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fillOpacity="0.3" />
      </svg>
    ),
    solid: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" />
      </svg>
    ),
    pattern: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="12" height="12" rx="2" />
        <circle cx="6" cy="6" r="1" fill="currentColor" />
        <circle cx="10" cy="10" r="1" fill="currentColor" />
        <circle cx="6" cy="10" r="1" fill="currentColor" />
        <circle cx="10" cy="6" r="1" fill="currentColor" />
      </svg>
    ),
  };

  return (
    <button
      type="button"
      onClick={() => {
        editor.setStyleForNextShapes(DefaultFillStyle, value);
        editor.setStyleForSelectedShapes(DefaultFillStyle, value);
      }}
      className={cn(
        "flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 transition-all border",
        isActive
          ? "bg-[#23295a] text-white shadow-sm border-[#23295a]"
          : "bg-stone-100 text-stone-700 hover:bg-stone-200 border-transparent hover:border-stone-300"
      )}
      title={label}
    >
      {fills[value]}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function DashOption({ value }: { value: TLDefaultDashStyle }) {
  const editor = useEditor();
  const currentDash = useValue('sharedDash', () => {
    const shared = editor.getSharedStyles().get(DefaultDashStyle);
    if (shared?.type === 'shared') return shared.value;
    return editor.getInstanceState().stylesForNextShape[DefaultDashStyle.id] as TLDefaultDashStyle | undefined;
  }, [editor]);
  const isActive = currentDash === value;

  const dashes: Record<string, React.ReactNode> = {
    draw: (
      <svg width="24" height="8" viewBox="0 0 24 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="0" y1="4" x2="24" y2="4" />
      </svg>
    ),
    dashed: (
      <svg width="24" height="8" viewBox="0 0 24 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="0" y1="4" x2="8" y2="4" />
        <line x1="16" y1="4" x2="24" y2="4" />
      </svg>
    ),
    dotted: (
      <svg width="24" height="8" viewBox="0 0 24 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="4" cy="4" r="1.5" fill="currentColor" />
        <circle cx="12" cy="4" r="1.5" fill="currentColor" />
        <circle cx="20" cy="4" r="1.5" fill="currentColor" />
      </svg>
    ),
  };

  return (
    <button
      type="button"
      onClick={() => {
        editor.setStyleForNextShapes(DefaultDashStyle, value);
        editor.setStyleForSelectedShapes(DefaultDashStyle, value);
      }}
      className={cn(
        "flex-1 h-8 rounded-lg flex items-center justify-center transition-all border",
        isActive
          ? "bg-[#23295a] text-white shadow-sm border-[#23295a]"
          : "bg-stone-100 text-stone-700 hover:bg-stone-200 border-transparent hover:border-stone-300"
      )}
      title={value}
    >
      {dashes[value]}
    </button>
  );
}

function SizeOption({ value }: { value: TLDefaultSizeStyle }) {
  const editor = useEditor();
  const currentSize = useValue('sharedSize', () => {
    const shared = editor.getSharedStyles().get(DefaultSizeStyle);
    if (shared?.type === 'shared') return shared.value;
    return editor.getInstanceState().stylesForNextShape[DefaultSizeStyle.id] as TLDefaultSizeStyle | undefined;
  }, [editor]);
  const isActive = currentSize === value;

  const sizes: Record<string, number> = {
    s: 3,
    m: 5,
    l: 7,
    xl: 9,
  };

  return (
    <button
      type="button"
      onClick={() => {
        editor.setStyleForNextShapes(DefaultSizeStyle, value);
        editor.setStyleForSelectedShapes(DefaultSizeStyle, value);
      }}
      className={cn(
        "flex-1 h-8 rounded-lg flex items-center justify-center transition-all border",
        isActive
          ? "bg-[#23295a] text-white shadow-sm border-[#23295a]"
          : "bg-stone-100 text-stone-700 hover:bg-stone-200 border-transparent hover:border-stone-300"
      )}
      title={value}
    >
      <div
        className="rounded-full bg-current"
        style={{
          width: sizes[value] || 5,
          height: sizes[value] || 5,
        }}
      />
    </button>
  );
}

// ─── Background panel toggle ─────────────────────────────────────────────────

function BackgroundPanelToggle({ isOpen, onToggle, onClose }: ToolbarPopoverProps) {
  const editor = useEditor();
  const { pages, currentPage, isPhone } = useWhiteboardToolbarContext();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const currentBg = useValue(
    "currentPageBg",
    () => {
      const pageData = pages.find((p) => p.number === currentPage);
      if (!pageData) return "white" as PageBackground;
      const shape = editor.getShape(pageData.id);
      if (!shape) return "white" as PageBackground;
      return parsePageBackground(shape.meta?.background);
    },
    [editor, pages, currentPage]
  );

  const setBackground = (bg: PageBackground) => {
    const pageData = pages.find((p) => p.number === currentPage);
    if (!pageData) return;
    editor.updateShape({
      id: pageData.id,
      type: "frame",
      meta: { background: bg },
    });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center transition-all",
          isOpen
            ? "bg-[#23295a] text-white shadow-lg scale-110"
            : "text-stone-600 hover:bg-stone-100 active:bg-stone-200"
        )}
        style={isOpen ? { backgroundColor: "#23295a", color: "#ffffff" } : undefined}
        title={isOpen ? "Close background picker" : "Page background"}
        aria-label={isOpen ? "Close background picker" : "Page background"}
      >
        {isOpen ? <X className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
      </button>

      {isOpen && (
        <div
          className={cn(
            "absolute z-[400] bg-white rounded-2xl shadow-2xl border border-stone-200/80 overflow-hidden",
            isPhone
              ? "bottom-full right-0 mb-2 w-[min(85vw,220px)]"
              : "right-0 top-full mt-2 w-[220px] max-w-[calc(100vw-1rem)]"
          )}
        >
          <div className="px-3 py-2 border-b border-stone-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-700">Page Background</span>
            <button
              type="button"
              onClick={onClose}
              className="w-6 h-6 rounded-md flex items-center justify-center text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-2.5 grid grid-cols-4 gap-1.5">
            {PAGE_BACKGROUND_OPTIONS.map((opt) => {
              const isActive = currentBg === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setBackground(opt.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl p-1.5 transition-all border-2",
                    isActive
                      ? "border-[#23295a] shadow-sm scale-105"
                      : "border-transparent hover:border-stone-300"
                  )}
                  title={opt.label}
                >
                  {/* Mini preview thumbnail */}
                  <div
                    className="w-full rounded-md border border-stone-200/60"
                    style={{
                      aspectRatio: "4/3",
                      ...getBackgroundStyle(opt.value, 0.35),
                    }}
                  />
                  <span className="text-[9px] font-medium text-stone-600 leading-tight text-center whitespace-nowrap overflow-hidden text-ellipsis w-full">
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Screenshot brush overlay ────────────────────────────────────────────────

/**
 * Renders a dashed selection rectangle while the screenshot tool is active.
 * Converts page-space brush coordinates to viewport space so the rect tracks
 * correctly at any zoom level.
 */
const ScreenshotBrushOverlay = track(function ScreenshotBrushOverlay() {
  const editor = useEditor();
  const brush = useValue("screenshot brush", () => screenshotBrushAtom.get(), []);

  if (!brush || brush.w < 1 || brush.h < 1) return null;

  const tl = editor.pageToViewport({ x: brush.x, y: brush.y });
  const br = editor.pageToViewport({ x: brush.x + brush.w, y: brush.y + brush.h });

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: tl.x,
        top: tl.y,
        width: br.x - tl.x,
        height: br.y - tl.y,
        border: "2px dashed #6366f1",
        borderRadius: 2,
        background: "rgba(99,102,241,0.08)",
        zIndex: 300,
      }}
    />
  );
});

// ─── Canvas overlays (image/PDF import) ─────────────────────────────────────

const PenModeIndicator = track(function PenModeIndicator() {
  const editor = useEditor();
  const isPenMode = useValue("isPenMode", () => editor.getInstanceState().isPenMode, [editor]);

  if (!isPenMode) return null;

  return (
    <button
      type="button"
      onClick={() => editor.updateInstanceState({ isPenMode: false })}
      className="absolute top-4 left-1/2 -translate-x-1/2 z-[200] pointer-events-auto flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50/90 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-amber-700 shadow-sm active:scale-95 transition-transform"
      title="Pencil-only mode active — tap to allow finger input"
      aria-label="Exit pencil-only mode"
    >
      <PencilOff className="w-3.5 h-3.5 shrink-0" />
      <span>Pencil Only — tap to use fingers</span>
    </button>
  );
});

export function WhiteboardCanvasOverlays() {
  return (
    <>
      <PenModeIndicator />
      <ScreenshotBrushOverlay />
      <WhiteboardClipboardPaste />
      <WhiteboardImageImport />
      <WhiteboardPdfImport />
    </>
  );
}

/**
 * Clipboard paste: reads image from clipboard and imports to current page.
 */
function WhiteboardClipboardPaste() {
  const editor = useEditor();
  const toasts = useToasts();
  const { pageManager, onPagesChanged, currentPage, uploadFile } =
    useWhiteboardToolbarContext();

  useEffect(() => {
    const handleImportError = (event: Event) => {
      const detail =
        event instanceof CustomEvent &&
        event.detail &&
        typeof event.detail === "object" &&
        typeof (event.detail as { message?: unknown }).message === "string"
          ? (event.detail as { message: string }).message
          : "Could not import image.";

      toasts.addToast({
        title: "Import failed",
        description: detail,
      });
    };

    window.addEventListener(WHITEBOARD_IMPORT_ERROR_EVENT, handleImportError);
    return () => {
      window.removeEventListener(WHITEBOARD_IMPORT_ERROR_EVENT, handleImportError);
    };
  }, [toasts]);

  const handlePaste = useCallback(async () => {
    if (!pageManager || !uploadFile) return;

    try {
      if (!navigator.clipboard?.read) {
        toasts.addToast({
          title: "Clipboard not available",
          description:
            "Your browser doesn't support clipboard access. Try Ctrl+V / Cmd+V instead.",
        });
        return;
      }

      const items = await navigator.clipboard.read();
      let imageFile: File | null = null;

      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const ext = imageType.split("/")[1]?.split("+")[0] || "png";
          imageFile = new File([blob], `pasted-image.${ext}`, {
            type: imageType,
          });
          break;
        }
      }

      if (!imageFile) {
        toasts.addToast({
          title: "No image in clipboard",
          description: "Copy an image first, then tap the paste button.",
        });
        return;
      }

      const { importImageToWhiteboard } = await import("../lib/import-image");
      await importImageToWhiteboard(
        editor,
        imageFile,
        pageManager,
        currentPage
      );

      onPagesChanged?.();
      toasts.addToast({
        title: "Image pasted",
        description: "Added clipboard image to whiteboard",
      });
    } catch (err) {
      const isDenied =
        err instanceof DOMException && err.name === "NotAllowedError";
      toasts.addToast({
        title: isDenied ? "Clipboard permission denied" : "Paste failed",
        description: isDenied
          ? "Allow clipboard access when prompted, then try again."
          : err instanceof Error
            ? err.message
            : "Could not read image from clipboard.",
      });
    }
  }, [editor, pageManager, onPagesChanged, toasts, currentPage, uploadFile]);

  useEffect(() => {
    setPasteHandler(editor, handlePaste);
    return () => setPasteHandler(editor, null);
  }, [editor, handlePaste]);

  return null;
}

/**
 * Image import: file input + insert on current page.
 */
function WhiteboardImageImport() {
  const editor = useEditor();
  const toasts = useToasts();
  const { pageManager, onPagesChanged, currentPage } =
    useWhiteboardToolbarContext();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importPhase, setImportPhase] = useState<ImageImportPhase>("preparing");

  useEffect(() => {
    setImageInputRef(editor, imageInputRef);
    return () => setImageInputRef(editor, { current: null });
  }, [editor]);

  const handleImageFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !pageManager) return;

      setIsImporting(true);
      setImportPhase("preparing");
      try {
        const { importImageToWhiteboard } = await import("../lib/import-image");
        await importImageToWhiteboard(
          editor,
          file,
          pageManager,
          currentPage,
          { onPhaseChange: setImportPhase }
        );

        onPagesChanged?.();
        toasts.addToast({
          title: "Image imported",
          description: `Added ${file.name} to whiteboard`,
        });
      } catch (err) {
        toasts.addToast({
          title: "Import failed",
          description:
            err instanceof Error ? err.message : "Failed to import image",
        });
      } finally {
        setIsImporting(false);
      }
    },
    [editor, pageManager, onPagesChanged, toasts, currentPage]
  );

  if (!pageManager) return null;

  return (
    <>
      <input
        type="file"
        ref={imageInputRef}
        onChange={handleImageFileSelected}
        accept={WHITEBOARD_IMAGE_ACCEPT_ATTR}
        className="hidden"
      />
      {isImporting && importPhase !== "uploading" && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[300] pointer-events-auto bg-white/80 backdrop-blur-sm border border-black/10 shadow-sm rounded-lg px-3 py-2 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin text-stone-500" />
          <span className="text-xs text-stone-600">
            {importPhase === "placing"
                ? "Placing image..."
                : "Preparing image..."}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * PDF import: file input + placement dialog + progress.
 */
function WhiteboardPdfImport() {
  const editor = useEditor();
  const toasts = useToasts();
  const { pageManager, onPagesChanged, currentPage, onPageChange, whiteboardUrl, whiteboardToken } =
    useWhiteboardToolbarContext();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const [showPlacementDialog, setShowPlacementDialog] = useState(false);

  useEffect(() => {
    setPdfInputRef(editor, pdfInputRef);
    return () => setPdfInputRef(editor, { current: null });
  }, [editor]);

  const handlePdfFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !pageManager) return;
      setPendingPdfFile(file);
      setShowPlacementDialog(true);
    },
    [pageManager]
  );

  const handlePdfImportWithPlacement = useCallback(
    async (placement: "on" | "after") => {
      setShowPlacementDialog(false);
      const file = pendingPdfFile;
      setPendingPdfFile(null);
      if (!file || !pageManager || !whiteboardUrl || !whiteboardToken) return;

      setIsImporting(true);
      setImportProgress("Preparing PDF...");

      try {
        const { importPdfToWhiteboard } = await import("../lib/import-pdf");
        const result = await importPdfToWhiteboard({
          editor,
          file,
          pageManager,
          whiteboardUrl,
          token: whiteboardToken,
          onProgress: (current, total) => {
            setImportProgress(`Importing page ${current}/${total}...`);
          },
          insertPosition: { type: placement, page: currentPage },
        });
        onPagesChanged?.();

        const targetPage =
          placement === "on" ? currentPage : currentPage + 1;
        onPageChange?.(targetPage);

        const description =
          result.pagesFailed > 0
            ? `Imported ${result.pagesImported} page${result.pagesImported === 1 ? "" : "s"} from ${file.name} (${result.pagesFailed} failed)`
            : `Imported ${result.pagesImported} page${result.pagesImported === 1 ? "" : "s"} from ${file.name}`;
        toasts.addToast({
          title: result.pagesFailed > 0 ? "PDF partially imported" : "PDF imported",
          description,
        });
      } catch (err) {
        toasts.addToast({
          title: "Import failed",
          description:
            err instanceof Error ? err.message : "Failed to import PDF",
        });
      } finally {
        setIsImporting(false);
        setImportProgress("");
      }
    },
    [
      editor,
      pageManager,
      onPagesChanged,
      onPageChange,
      toasts,
      pendingPdfFile,
      currentPage,
      whiteboardUrl,
      whiteboardToken,
    ]
  );

  if (!pageManager) return null;

  return (
    <>
      <input
        type="file"
        ref={pdfInputRef}
        onChange={handlePdfFileSelected}
        accept="application/pdf"
        className="hidden"
      />

      {isImporting && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[300] pointer-events-auto bg-white/80 backdrop-blur-sm border border-black/10 shadow-sm rounded-lg px-3 py-2 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin text-stone-500" />
          <span className="text-xs text-stone-600">{importProgress}</span>
        </div>
      )}

      {showPlacementDialog && (
        <div
          className="absolute inset-0 z-[500] pointer-events-auto flex items-center justify-center bg-black/40"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowPlacementDialog(false);
              setPendingPdfFile(null);
            }
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl p-6 max-w-sm mx-4"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-lg font-semibold text-stone-900">
                Insert PDF pages
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowPlacementDialog(false);
                  setPendingPdfFile(null);
                }}
                className="rounded-lg p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-sm text-stone-500">
              Where should the PDF pages be inserted relative to page{" "}
              {currentPage}?
            </p>
            <div className="flex gap-2 justify-end mt-4">
              <button
                type="button"
                onClick={() => handlePdfImportWithPlacement("on")}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors"
              >
                On this page
              </button>
              <button
                type="button"
                onClick={() => handlePdfImportWithPlacement("after")}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors"
              >
                Next page
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


// ─── Excalidraw-style Properties Panel ──────────────────────────────────────

function PropertiesSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5 px-0.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function PanelColorSwatch({ value }: { value: TLDefaultColorStyle }) {
  const editor = useEditor();
  const currentColor = useValue('panelColor', () => {
    const shared = editor.getSharedStyles().get(DefaultColorStyle);
    if (shared?.type === 'shared') return shared.value;
    return editor.getInstanceState().stylesForNextShape[DefaultColorStyle.id] as TLDefaultColorStyle | undefined;
  }, [editor]);
  const isActive = currentColor === value;

  return (
    <button
      type="button"
      onClick={() => {
        editor.setStyleForNextShapes(DefaultColorStyle, value);
        editor.setStyleForSelectedShapes(DefaultColorStyle, value);
      }}
      className={cn(
        "rounded-full transition-all border outline-hidden",
        isActive ? "scale-125 shadow-sm ring-1 ring-offset-1 ring-[#23295a]/40" : "hover:scale-110",
        value === 'white' ? "border-stone-300" : "border-transparent"
      )}
      style={{ backgroundColor: COLOR_MAP[value], width: '16px', height: '16px', flexShrink: 0 }}
      title={value}
      aria-label={`Color: ${value}`}
    />
  );
}
