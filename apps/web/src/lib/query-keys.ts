/**
 * Query key factory for consistent cache management.
 * User-specific cache isolation is handled by router.invalidate() on auth transitions.
 */
export const queryKeys = {
  session: () => ["session"] as const,
  rememberedUser: () => ["remembered-user"] as const,
  rooms: {
    all: () => ["rooms"] as const,
    recent: () => ["rooms", "recent-sessions"] as const,
    active: () => ["rooms", "active-sessions"] as const,
    links: () => ["rooms", "permanent"] as const,
    detail: (code: string) => ["rooms", code] as const,
    summary: (code: string) => ["rooms", code, "summary"] as const,
    transcripts: (code: string) => ["rooms", code, "transcripts"] as const,
  },
  // Temporary compatibility while components are renamed from meetings -> rooms/sessions.
  meetings: {
    all: () => ["rooms"] as const,
    recent: () => ["rooms", "recent-sessions"] as const,
    active: () => ["rooms", "active-sessions"] as const,
    links: () => ["rooms", "permanent"] as const,
    detail: (id: string) => ["sessions", id] as const,
    byCode: (code: string) => ["rooms", code] as const,
    summary: (id: string) => ["sessions", id, "summary"] as const,
    transcripts: (id: string) => ["sessions", id, "transcripts"] as const,
  },
  spaces: {
    all: () => ["spaces"] as const,
    detail: (id: string) => ["spaces", id] as const,
    members: (id: string) => ["spaces", id, "members"] as const,
  },
  assets: {
    all: () => ["assets"] as const,
    bySpace: (spaceId: string) => ["assets", "space", spaceId] as const,
  },
  linkedAccounts: () => ["linkedAccounts"] as const,
  passkeys: () => ["settings", "passkeys"] as const,
  sessions: {
    all: () => ["sessions"] as const,
  },
};
