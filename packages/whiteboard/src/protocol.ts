export const WHITEBOARD_EVENTS = {
  STATE: "whiteboard.state",
  ACCESS_REQUESTED: "whiteboard.access.requested",
  ACCESS_GRANTED: "whiteboard.access.granted",
  ACCESS_DENIED: "whiteboard.access.denied",
  ACCESS_REVOKED: "whiteboard.access.revoked",
  SESSION_ENDING: "whiteboard.session.ending",
  PAGE_SYNC: "whiteboard.page.sync",
  ASSISTANT_PANEL_OPEN: "assistant.panel.open",
  ASSISTANT_PANEL_CLOSE: "assistant.panel.close",
  ASSISTANT_CHAT_USER: "assistant.chat.user",
  ASSISTANT_CHAT_ASSISTANT: "assistant.chat.assistant",
  ASSISTANT_CHAT_STREAMING: "assistant.chat.streaming",
  ASSISTANT_CHAT_CLEAR: "assistant.chat.clear",
  WIKI_SEARCH: "wiki.search",
  WIKI_RESULT: "wiki.result",
  WIKI_DISMISS: "wiki.dismiss",
} as const;

export const LEGACY_WHITEBOARD_EVENTS = {
  WRITER_STATE: "writer_state",
  WRITER_REQUEST: "writer.request",
  WRITER_APPROVED: "writer.approved",
  WRITER_DENIED: "writer.denied",
  WRITER_RELEASED: "writer.released",
  PAGE_SYNC: "page.sync",
  SESSION_ENDING: "session.ending",
} as const;

export function isWhiteboardStateEvent(type: unknown): boolean {
  return type === WHITEBOARD_EVENTS.STATE || type === LEGACY_WHITEBOARD_EVENTS.WRITER_STATE;
}

export function isCanvasAccessRequestEvent(type: unknown): boolean {
  return type === WHITEBOARD_EVENTS.ACCESS_REQUESTED || type === LEGACY_WHITEBOARD_EVENTS.WRITER_REQUEST;
}

export function isCanvasAccessGrantedEvent(type: unknown): boolean {
  return type === WHITEBOARD_EVENTS.ACCESS_GRANTED || type === LEGACY_WHITEBOARD_EVENTS.WRITER_APPROVED;
}

export function isCanvasAccessDeniedEvent(type: unknown): boolean {
  return type === WHITEBOARD_EVENTS.ACCESS_DENIED || type === LEGACY_WHITEBOARD_EVENTS.WRITER_DENIED;
}

export function isCanvasAccessRevokedEvent(type: unknown): boolean {
  return type === WHITEBOARD_EVENTS.ACCESS_REVOKED || type === LEGACY_WHITEBOARD_EVENTS.WRITER_RELEASED;
}

export function isPageSyncEvent(type: unknown): boolean {
  return type === WHITEBOARD_EVENTS.PAGE_SYNC || type === LEGACY_WHITEBOARD_EVENTS.PAGE_SYNC;
}
