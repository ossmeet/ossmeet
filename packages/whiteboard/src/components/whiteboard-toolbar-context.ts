import { createContext, useContext } from "react";
import type React from "react";
import type { PageManager, WhiteboardPage } from "../lib/page-manager";
import type { UploadFileFn } from "./meeting-whiteboard";

export interface WhiteboardToolbarContextValue {
  pageManager: PageManager | null;
  onPagesChanged?: () => void;
  currentPage: number;
  pages: WhiteboardPage[];
  onAddPage?: () => void;
  onInsertPageAfter?: (afterPageNumber: number) => void;
  onClearPage?: () => void;
  onPageChange?: (pageNumber: number) => void;
  canEditCanvas: boolean;
  uploadFile?: UploadFileFn;
  isPhone?: boolean;
  aiEnabled?: boolean;
  onToggleAi?: () => void;
  isAiPanelOpen?: boolean;
  isLoading?: boolean;
  isConnected?: boolean;
  whiteboardUrl?: string;
  whiteboardToken?: string;
}

export const WhiteboardToolbarContext = createContext<WhiteboardToolbarContextValue>({
  pageManager: null,
  currentPage: 1,
  pages: [],
  canEditCanvas: false,
  isPhone: false,
  isAiPanelOpen: false,
  isLoading: false,
  isConnected: false,
});

export function useWhiteboardToolbarContext() {
  return useContext(WhiteboardToolbarContext);
}

const editorInstanceRegistry = new WeakMap<object, {
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  pdfInputRef: React.RefObject<HTMLInputElement | null>;
  pasteHandler: (() => void) | null;
}>();

function getRegistry(key: object) {
  let reg = editorInstanceRegistry.get(key);
  if (!reg) {
    reg = { imageInputRef: { current: null }, pdfInputRef: { current: null }, pasteHandler: null };
    editorInstanceRegistry.set(key, reg);
  }
  return reg;
}

export function setImageInputRef(
  key: object,
  ref: React.RefObject<HTMLInputElement | null>,
) {
  getRegistry(key).imageInputRef = ref;
}

export function setPasteHandler(key: object, handler: (() => void) | null) {
  getRegistry(key).pasteHandler = handler;
}

export function setPdfInputRef(
  key: object,
  ref: React.RefObject<HTMLInputElement | null>,
) {
  getRegistry(key).pdfInputRef = ref;
}

export function getEditorActions(key: object) {
  return getRegistry(key);
}
