import type { ComponentType } from "react";

export type RecorderStatus = "loading" | "ready" | "error";

export interface RecorderWhiteboardProps {
  whiteboardUrl: string;
  token: string;
  onStatusChange?: (status: RecorderStatus) => void;
  onContentStateChange?: (hasContent: boolean) => void;
}

export interface RecorderModule {
  RecorderWhiteboard: ComponentType<RecorderWhiteboardProps>;
}

export async function loadRecorderModule(): Promise<RecorderModule> {
  const module = await import("../react");
  return { RecorderWhiteboard: module.RecorderWhiteboard };
}
