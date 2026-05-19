import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import {
  TLSocketRoom,
  SQLiteSyncStorage,
  NodeSqliteWrapper,
} from "@tldraw/sync-core";
import type { TLRecord } from "@tldraw/tlschema";
import { classifyBroadcastAudience, getBroadcastMessageType } from "./security";
import { WHITEBOARD_EVENTS } from "./protocol";
import { WHITEBOARD_CONFIG } from "./lib/constants";
import { RateLimiter } from "./lib/rate-limiter";
import { defaultTLSchema } from "./room-schema";
import type {
  PendingSnapshotFile,
  SessionMeta,
  StoredCanvasEditorGrant,
  TldrawSocket,
  WsData,
} from "./room-types";
import {
  deleteFileIfExists,
  ensureRoomDataDir,
  getNewestRoomDbMtimeMs,
  hasPendingSnapshot,
  readPendingSnapshotFile,
  readRoomDataDir,
  removeRoomFiles,
  roomStorageInitialized,
} from "./room-storage";
export type { WsData } from "./room-types";

const MAX_ACCESS_REQUEST_USER_NAME_LENGTH = 256;

function normalizeAccessRequestUserName(userName: string): string {
  const stripped = userName.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return stripped.slice(0, MAX_ACCESS_REQUEST_USER_NAME_LENGTH) || "Anonymous";
}

// TTL for persisted canvas editor grants (24 hours)
const CANVAS_EDITOR_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

// Maximum pending requests per room
const MAX_PENDING_REQUESTS = 100;

// Maximum broadcasts per user per second
const MAX_BROADCASTS_PER_USER_PER_SECOND = 10;

// Maximum AI chat messages to keep in memory per room
const MAX_AI_CHAT_MESSAGES = 100;
const BROADCAST_WINDOW_MS = 1000;
const AUTO_SNAPSHOT_INTERVAL_MS = 60_000;

class Room {
  private room: TLSocketRoom<TLRecord, SessionMeta>;
  // rate-limit on userId instead of tldrawSessionId to prevent 3× bypass
  private rateLimiter = new RateLimiter(300, 1000);
  private canvasEditorUserIds = new Set<string>();
  // Track when each canvas editor grant was issued to enforce TTL on restore.
  private canvasEditorGrantedAt = new Map<string, number>();
  private pendingEditorRequests = new Map<
    string,
    { userId: string; userName: string }
  >();
  private actingManagerId: string | null = null;
  private navigationControllerUserId: string | null = null;
  private navigationControllerName: string | null = null;
  private currentSyncedPage = 1;
  private hostDepartureTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly MAX_CONNECTIONS_PER_USER = 3;
  private userConnectionCount = new Map<string, number>();
  private aiPanelOpen = false;
  private aiChatMessages: Array<{ id: string; role: string; content: string; userName?: string; whiteboardAttached?: boolean }> = [];
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private autosnapshotInterval: ReturnType<typeof setInterval> | null = null;
  private lastPushedSnapshotClock = 0;
  private lastPushedSnapshotPayloadHash: string | null = null;
  private snapshotPushInFlight = false;
  private snapshotPushFailureCount = 0;
  private nextSnapshotPushAllowedAt = 0;
  private db: InstanceType<typeof Database>;
  private activeSockets = new Map<string, TldrawSocket>();
  // Cache of session metadata indexed by tldrawSessionId to avoid O(n) getSessions().find() scans.
  private sessionMetaIndex = new Map<string, SessionMeta>();
  private closed = false;
  private ending = false;
  // per-user broadcast rate limiting
  private broadcastRateLimiter = new Map<string, { count: number; windowStart: number }>();

  private readonly dbPath: string;
  private readonly pendingSnapshotPath: string;

  constructor(
    readonly sessionId: string,
    private readonly dataDir: string,
    private onEmpty: () => void,
    private readonly callbackUrl?: string,
    private readonly callbackSecret?: string,
    initialSnapshot?: unknown,
  ) {
    this.dbPath = `${dataDir}/${sessionId}.db`;
    this.pendingSnapshotPath = `${this.dbPath}.snapshot.json`;
    this.db = new Database(this.dbPath);

    this.db.exec(
      `CREATE TABLE IF NOT EXISTS whiteboard_meta (key TEXT PRIMARY KEY, value TEXT)`
    );

    const canvasEditorUserIdsJson =
      this.getMeta("canvasEditorUserIds") ?? this.getMeta("approvedWriters");
    if (canvasEditorUserIdsJson) {
      // Restore canvas editor grants with TTL validation.
      const now = Date.now();
      let stored: StoredCanvasEditorGrant[];
      try {
        const parsed = JSON.parse(canvasEditorUserIdsJson);
        stored = Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.error(`[Room ${sessionId}] Ignoring corrupt canvas editor grant metadata:`, error);
        stored = [];
        this.setMeta("canvasEditorUserIds", null);
        this.setMeta("approvedWriters", null);
      }
      for (const entry of stored) {
        // Support the old format (plain string array) and both timestamp field names.
        const userId = typeof entry === "string" ? entry : entry.userId;
        if (typeof userId !== "string" || !userId) continue;
        const grantedAt = typeof entry === "string" ? 0 : (entry.grantedAt ?? entry.approvedAt ?? 0);
        if (now - grantedAt < CANVAS_EDITOR_GRANT_TTL_MS) {
          this.canvasEditorUserIds.add(userId);
          this.canvasEditorGrantedAt.set(userId, grantedAt);
        } else {
          console.info(
            `[Room ${sessionId}] Expired canvas editor grant for ${userId} (${Math.round((now - grantedAt) / 3600_000)}h old) — not restored`
          );
        }
      }
      this.persistCanvasEditorGrants();
      this.setMeta("approvedWriters", null);
    }
    const actingManagerId = this.getMeta("actingManagerId") ?? this.getMeta("promotedHostId");
    if (actingManagerId) {
      this.actingManagerId = actingManagerId;
      this.persistActingManager();
      this.setMeta("promotedHostId", null);
    }

    const persistedCurrentPage = Number(this.getMeta("currentSyncedPage"));
    if (Number.isInteger(persistedCurrentPage) && persistedCurrentPage >= 1) {
      this.currentSyncedPage = persistedCurrentPage;
    }

    const sql = new NodeSqliteWrapper(this.db);
    const hasStorageData = SQLiteSyncStorage.hasBeenInitialized(sql);
    const storage = new SQLiteSyncStorage<TLRecord>({
      sql,
      snapshot: hasStorageData ? undefined : initialSnapshot as never,
    });

    this.room = new TLSocketRoom<TLRecord, SessionMeta>({
      schema: defaultTLSchema,
      storage,
      onSessionRemoved: (_room, { meta }) => {
        const count = this.userConnectionCount.get(meta.userId) ?? 0;
        if (count <= 1) {
          this.userConnectionCount.delete(meta.userId);
        } else {
          this.userConnectionCount.set(meta.userId, count - 1);
        }
      },
      // When the server sends the tldraw "connect" response, the session has just
      // transitioned from AwaitingConnectMessage → Connected. We schedule a
      // broadcastWhiteboardState() so the newly connected client receives its write
      // access status. Without this, broadcastWhiteboardState() called from
      // handleConnect() is silently dropped by tldraw (session not yet Connected).
      onBeforeSendMessage: ({ stringified }) => {
        if (typeof stringified !== "string") return;
        if (!stringified.includes('"type":"connect"')) return;

        try {
          const parsed = JSON.parse(stringified);
          if (parsed?.type !== "connect") return;
          setTimeout(() => {
            if (!this.closed) {
              this.broadcastWhiteboardState();
            }
          }, 0);
        } catch {
          // ignore malformed JSON payloads
        }
      },
      log: {
        warn: (...args: unknown[]) =>
          console.warn("[Room]", this.sessionId, ...args),
        error: (...args: unknown[]) =>
          console.error("[Room]", this.sessionId, ...args),
      },
    });

    this.autosnapshotInterval = setInterval(() => {
      void this.maybePushSnapshot();
    }, AUTO_SNAPSHOT_INTERVAL_MS);
  }

  private getSnapshotLastChangedClock(snapshot: unknown): number | null {
    if (!snapshot || typeof snapshot !== "object") return null;
    const documents = (snapshot as { documents?: unknown }).documents;
    if (!Array.isArray(documents)) return null;
    let maxClock = 0;
    let found = false;
    for (const document of documents) {
      if (!document || typeof document !== "object") continue;
      const clock = (document as { lastChangedClock?: unknown }).lastChangedClock;
      if (typeof clock !== "number" || !Number.isFinite(clock)) continue;
      if (!found || clock > maxClock) maxClock = clock;
      found = true;
    }
    return found ? maxClock : null;
  }

  private async buildSnapshotPayload(snapshot: unknown): Promise<{ body: string; hash: string } | null> {
    try {
      const body = JSON.stringify({ sessionId: this.sessionId, snapshot });
      // SHA-256 truncated to 128 bits for collision-resistant dedup.
      // Negligible collision probability vs 32-bit FNV-1a (~65K snapshots for 1%).
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
      const hex = Buffer.from(digest).toString("hex").slice(0, 32);
      return { body, hash: hex };
    } catch (error) {
      console.error(`[Room ${this.sessionId}] Failed to serialize snapshot payload:`, error);
      return null;
    }
  }

  private persistPendingSnapshot(
    payload: { body: string; hash: string },
    options?: { final?: boolean; deleteRoomFilesOnSuccess?: boolean },
  ): void {
    const pending: PendingSnapshotFile = {
      sessionId: this.sessionId,
      body: payload.body,
      hash: payload.hash,
      savedAt: Date.now(),
      final: options?.final === true,
      deleteRoomFilesOnSuccess: options?.deleteRoomFilesOnSuccess === true,
    };
    try {
      writeFileSync(this.pendingSnapshotPath, JSON.stringify(pending), { encoding: "utf8" });
    } catch (error) {
      console.error(`[Room ${this.sessionId}] Failed to persist pending snapshot:`, error);
    }
  }

  private clearPendingSnapshot(hash?: string): void {
    if (hash) {
      try {
        const raw = readFileSync(this.pendingSnapshotPath, "utf8");
        const pending = JSON.parse(raw) as Partial<PendingSnapshotFile>;
        if (pending.hash && pending.hash !== hash) return;
      } catch {
        // If the file is unreadable, attempt removal below.
      }
    }
    try {
      unlinkSync(this.pendingSnapshotPath);
    } catch {
      // File may not exist.
    }
  }

  private parseRetryAfterMs(retryAfterHeader: string | null): number | null {
    if (!retryAfterHeader) return null;
    const asSeconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return asSeconds * 1000;
    }
    const asDate = Date.parse(retryAfterHeader);
    if (Number.isNaN(asDate)) return null;
    return Math.max(0, asDate - Date.now());
  }

  private applySnapshotPushBackoff(retryAfterMs: number | null): void {
    this.snapshotPushFailureCount = Math.min(this.snapshotPushFailureCount + 1, 8);
    const exponentialDelayMs = Math.min(
      10 * 60_000,
      15_000 * 2 ** (this.snapshotPushFailureCount - 1)
    );
    const delayMs = Math.max(exponentialDelayMs, retryAfterMs ?? 0);
    this.nextSnapshotPushAllowedAt = Date.now() + delayMs;
    console.warn(
      `[Room ${this.sessionId}] Snapshot push backoff ${delayMs}ms after ${this.snapshotPushFailureCount} consecutive failure(s)`
    );
  }

  private resetSnapshotPushBackoff(): void {
    this.snapshotPushFailureCount = 0;
    this.nextSnapshotPushAllowedAt = 0;
  }

  private async maybePushSnapshot(force = false): Promise<boolean> {
    if (this.closed) return false;
    if (!this.callbackUrl || !this.callbackSecret) return false;
    if (!force && this.room.getNumActiveSessions() === 0) return false;
    if (!force && Date.now() < this.nextSnapshotPushAllowedAt) return false;
    if (this.snapshotPushInFlight) return false;

    let snapshot: unknown;
    try {
      snapshot = this.room.getCurrentSnapshot();
    } catch (e) {
      console.error(`[Room ${this.sessionId}] Failed to capture snapshot:`, e);
      return false;
    }

    const clock = this.getSnapshotLastChangedClock(snapshot);
    if (!force && clock !== null && clock <= this.lastPushedSnapshotClock) {
      return false;
    }

    const payload = await this.buildSnapshotPayload(snapshot);
    if (!payload) return false;
    if (!force && payload.hash === this.lastPushedSnapshotPayloadHash) {
      return false;
    }

    this.snapshotPushInFlight = true;
    try {
      const result = await this.pushSnapshot(payload.body);
      // Re-check after every await: the room may have been closed by
      // SIGTERM → roomManager.closeAll() during the network call.
      if (this.closed) return false;
      if (result.ok) {
        this.resetSnapshotPushBackoff();
        this.lastPushedSnapshotPayloadHash = payload.hash;
        this.clearPendingSnapshot(payload.hash);
        if (clock !== null && clock > this.lastPushedSnapshotClock) {
          this.lastPushedSnapshotClock = clock;
        }
        return true;
      }

      if (force) {
        this.persistPendingSnapshot(payload);
      }
      if (!force) {
        this.applySnapshotPushBackoff(result.retryAfterMs);
      }
      return false;
    } finally {
      this.snapshotPushInFlight = false;
    }
  }

  private getMeta(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM whiteboard_meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string | null): void {
    if (value === null) {
      this.db.prepare("DELETE FROM whiteboard_meta WHERE key = ?").run(key);
    } else {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO whiteboard_meta (key, value) VALUES (?, ?)"
        )
        .run(key, value);
    }
  }

  private canEditCanvas(userId: string, role: string): boolean {
    if (role === "host") return true;
    if (!this.canvasEditorUserIds.has(userId)) return false;
    // Enforce TTL even in active sessions, not just on room restore.
    const grantedAt = this.canvasEditorGrantedAt.get(userId);
    if (grantedAt && Date.now() - grantedAt >= CANVAS_EDITOR_GRANT_TTL_MS) {
      this.canvasEditorUserIds.delete(userId);
      this.canvasEditorGrantedAt.delete(userId);
      this.persistCanvasEditorGrants();
      return false;
    }
    return true;
  }

  private persistCanvasEditorGrants(): void {
    // Persist with timestamps for TTL validation on restore.
    const entries = [...this.canvasEditorUserIds].map((userId) => ({
      userId,
      grantedAt: this.canvasEditorGrantedAt.get(userId) ?? Date.now(),
    }));
    this.setMeta("canvasEditorUserIds", JSON.stringify(entries));
  }

  private persistActingManager(): void {
    this.setMeta("actingManagerId", this.actingManagerId);
  }

  private persistCurrentPage(): void {
    this.setMeta("currentSyncedPage", String(this.currentSyncedPage));
  }

  private hasActiveSocket(sessionId: string): boolean {
    const socket = this.activeSockets.get(sessionId);
    return Boolean(socket && socket.readyState === 1);
  }

  private sendCustomMessageIfConnected(sessionId: string, data: unknown): void {
    if (!this.hasActiveSocket(sessionId)) return;
    try {
      this.room.sendCustomMessage(sessionId, data);
    } catch {
      // Session may have disconnected between the socket check and send.
    }
  }

  // Schedule a reconnect for canvas edit access changes. Sends the grant/revoke
  // message, then closes only the session IDs that existed at call time after
  // a short delay. New connections established during the delay (e.g. from a
  // fast client reconnect) are left untouched — their tldraw session was
  // created after the write-access change, so it already reflects the new
  // permissions and doesn't need to be torn down.
  private scheduleCanvasAccessReconnect(userId: string): void {
    const sessionIds = this.room
      .getSessions()
      .filter((s) => s.meta.userId === userId)
      .map((s) => s.sessionId);
    if (sessionIds.length === 0) return;
    setTimeout(() => {
      if (this.closed) return;
      for (const sid of sessionIds) {
        try {
          this.room.closeSession(sid);
        } catch {
          // Session may have been removed already — safe to ignore.
        }
      }
    }, 200);
  }

  // Check custom-event broadcast rate limit per user.
  private checkBroadcastRateLimit(userId: string): boolean {
    const now = Date.now();
    const entry = this.broadcastRateLimiter.get(userId);
    if (!entry || now - entry.windowStart >= BROADCAST_WINDOW_MS) {
      this.broadcastRateLimiter.set(userId, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= MAX_BROADCASTS_PER_USER_PER_SECOND) return false;
    entry.count++;
    return true;
  }

  private canManageWhiteboard(userId: string): boolean {
    return this.room.getSessions().some(
      (s) =>
        s.meta.userId === userId &&
        (s.meta.role === "host" || userId === this.actingManagerId)
    );
  }

  handleConnect(ws: TldrawSocket, data: WsData): void {
    const { tldrawSessionId, userId, userName, role, roomId, connectionId } = data;

    if (this.ending) {
      ws.close(1001, "session ending");
      return;
    }

    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Evict stale sockets for this userId before checking the connection cap.
    // Race condition: a client can reconnect (after 1006 abnormal close) before
    // the WebSocket close event is processed on the server, burning through all
    // slots and entering an infinite 1006→reconnect→1008→reconnect loop.
    // Fix: scan activeSockets for this userId and remove any that are no longer
    // OPEN (readyState !== 1), decrementing the count so the new connection fits.
    const staleSessionIds: string[] = [];
    for (const session of [...this.room.getSessions()]) {
      if (session.meta.userId !== userId) continue;
      const staleSocket = this.activeSockets.get(session.sessionId);
      if (!staleSocket || staleSocket.readyState === 1) continue; // still OPEN
      staleSessionIds.push(session.sessionId);
    }
    for (const sessionId of staleSessionIds) {
      const staleSocket = this.activeSockets.get(sessionId);
      console.info(
        `[Room ${this.sessionId}] Evicting stale socket for ${userId} (readyState=${staleSocket?.readyState ?? "missing"}) before reconnect`
      );
      this.activeSockets.delete(sessionId);
      this.sessionMetaIndex.delete(sessionId);
      try {
        this.room.handleSocketClose(sessionId);
      } catch {
        // Session may already be removed from tldraw — safe to ignore
      }
    }
    // Reset the rate limiter only if the user now has zero connections.
    // onSessionRemoved (triggered by handleSocketClose above) already
    // decremented userConnectionCount, so a zero count means no live
    // sessions remain — safe to wipe the rate-limit state.
    if (staleSessionIds.length > 0 && !this.userConnectionCount.has(userId)) {
      this.rateLimiter.remove(userId);
    }

    // Check connection limit BEFORE establishing connection
    const currentCount = this.userConnectionCount.get(userId) ?? 0;
    if (currentCount >= this.MAX_CONNECTIONS_PER_USER) {
      ws.close(1008, "Too many connections");
      return;
    }

    const isReadonly = !this.canEditCanvas(userId, role);
    const meta: SessionMeta = { userId, userName, role, sessionId: roomId, connectionId };

    this.room.handleSocketConnect({
      sessionId: tldrawSessionId,
      socket: ws,
      isReadonly,
      meta,
    });

    this.activeSockets.set(tldrawSessionId, ws);
    this.sessionMetaIndex.set(tldrawSessionId, meta);

    // Increment connection count AFTER successful connection
    this.userConnectionCount.set(userId, currentCount + 1);

    console.info(
      `[Room ${this.sessionId}] Connected: ${userName} (${userId}) readonly=${isReadonly} (${currentCount + 1}/${this.MAX_CONNECTIONS_PER_USER} connections)`
    );

    if (role === "host") {
      // Cancel any pending host departure timer
      if (this.hostDepartureTimer) {
        clearTimeout(this.hostDepartureTimer);
        this.hostDepartureTimer = null;
      }
      if (this.actingManagerId) {
        console.info(
          `[Room ${this.sessionId}] Host returned — demoting acting host ${this.actingManagerId}`
        );
        this.actingManagerId = null;
        this.persistActingManager();
      }
    }

    // Wait for the tldraw connect handshake to finish before broadcasting state.
  }

  // rate-limit per userId (not per tldrawSessionId) to prevent 3× bypass
  handleMessage(tldrawSessionId: string, message: string | Uint8Array): void {
    if (this.ending || this.closed) return;

    const meta = this.sessionMetaIndex.get(tldrawSessionId);
    const userId = meta?.userId ?? tldrawSessionId;
    const messageBytes = typeof message === "string" ? message.length : message.byteLength;

    if (!this.rateLimiter.check(userId, messageBytes)) {
      console.warn("[Room] Rate limited, closing connection:", tldrawSessionId);
      // Close the WebSocket instead of silently dropping CRDT messages.
      const ws = this.activeSockets.get(tldrawSessionId);
      if (ws) ws.close(1008, "Rate limited");
      return;
    }
    try {
      this.room.handleSocketMessage(tldrawSessionId, message);
    } catch (e) {
      console.error(
        `[Room ${this.sessionId}] handleSocketMessage threw:`,
        e
      );
    }
  }

  handleClose(tldrawSessionId: string, code: number, ws?: TldrawSocket): void {
    console.info(
      `[Room ${this.sessionId}] Closed: ${tldrawSessionId} code=${code}`
    );
    const meta = this.sessionMetaIndex.get(tldrawSessionId);
    // (prevents new connection from being removed by old close event)
    const stored = this.activeSockets.get(tldrawSessionId);
    if (!ws || stored === ws) {
      this.activeSockets.delete(tldrawSessionId);
      this.sessionMetaIndex.delete(tldrawSessionId);
    }
    if (this.closed) return;
    this.handleDisconnect(tldrawSessionId, "close", meta);
  }

  handleError(tldrawSessionId: string, error: unknown, ws?: TldrawSocket): void {
    console.error("[Room] Error:", tldrawSessionId, error);
    const meta = this.sessionMetaIndex.get(tldrawSessionId);
    const stored = this.activeSockets.get(tldrawSessionId);
    if (!ws || stored === ws) {
      this.activeSockets.delete(tldrawSessionId);
      this.sessionMetaIndex.delete(tldrawSessionId);
    }
    if (this.closed) return;
    this.handleDisconnect(tldrawSessionId, "error", meta);
  }

  private handleDisconnect(
    tldrawSessionId: string,
    via: "close" | "error",
    meta = this.sessionMetaIndex.get(tldrawSessionId)
  ): void {
    if (via === "close") {
      this.room.handleSocketClose(tldrawSessionId);
    } else {
      this.room.handleSocketError(tldrawSessionId);
    }
    if (!meta?.userId || !this.userConnectionCount.has(meta.userId)) {
      this.rateLimiter.remove(meta?.userId ?? tldrawSessionId);
    }

    // Evict broadcast rate limiter entry when the user has no remaining connections.
    if (meta?.userId && !this.userConnectionCount.has(meta.userId)) {
      this.broadcastRateLimiter.delete(meta.userId);
    }

    // NOTE: Intentionally do NOT delete pendingEditorRequests on disconnect.

    if (
      meta?.role === "host" &&
      !this.userConnectionCount.has(meta.userId)
    ) {
      this.handleHostDeparture();
    }

    if (
      this.actingManagerId &&
      meta?.userId === this.actingManagerId &&
      !this.userConnectionCount.has(meta.userId)
    ) {
      this.handleActingManagerDeparture();
    }

    // Clear navigation control when the controller fully leaves the room.
    if (
      this.navigationControllerUserId &&
      meta?.userId === this.navigationControllerUserId &&
      !this.userConnectionCount.has(meta.userId)
    ) {
      this.navigationControllerUserId = null;
      this.navigationControllerName = null;
    }

    this.broadcastWhiteboardState();

    if (this.room.getNumActiveSessions() === 0) {
      const CLEANUP_DELAY_MS = 15 * 60 * 1000;
      console.info(
        `[Room ${this.sessionId}] No active sessions, cleanup scheduled in 15min`
      );
      if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
      this.cleanupTimer = setTimeout(() => {
        if (this.closed) return;
        // Preserve the SQLite room DB on idle cleanup so the next reconnect in
        // the same meeting resumes from the same authoritative state. The
        // snapshot push is best-effort and secondary to the on-disk room data.
        void this.maybePushSnapshot(true).catch((e) => {
          console.error(
            `[Room ${this.sessionId}] Failed to push snapshot before idle cleanup:`, e
          );
        }).finally(() => {
          this.close({ deleteFiles: false });
          this.onEmpty();
        });
      }, CLEANUP_DELAY_MS);
    }
  }

  close(options?: { deleteFiles?: boolean }): void {
    if (this.closed) return; // Guard against double-close
    this.closed = true;
    const deleteFiles = options?.deleteFiles ?? false;

    console.info(
      `[Room ${this.sessionId}] Cleanup: closing room and database${deleteFiles ? " (deleting files)" : ""}`
    );
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.autosnapshotInterval) {
      clearInterval(this.autosnapshotInterval);
      this.autosnapshotInterval = null;
    }
    if (this.hostDepartureTimer) {
      clearTimeout(this.hostDepartureTimer);
      this.hostDepartureTimer = null;
    }
    this.canvasEditorUserIds.clear();
    this.canvasEditorGrantedAt.clear();
    this.pendingEditorRequests.clear();
    this.userConnectionCount.clear();
    this.activeSockets.clear();
    this.sessionMetaIndex.clear();
    this.actingManagerId = null;
    this.navigationControllerUserId = null;
    this.navigationControllerName = null;
    this.broadcastRateLimiter.clear();
    this.rateLimiter.destroy();
    try {
      this.room.close();
    } catch (e) {
      console.error(
        `[Room ${this.sessionId}] Failed to close TLSocketRoom:`,
        e
      );
    }
    try {
      this.db.close();
    } catch (e) {
      console.error(
        `[Room ${this.sessionId}] Failed to close database:`,
        e
      );
    }
    if (deleteFiles) {
      // Explicit session end owns permanent deletion. Ordinary idle cleanup and
      // server restarts keep the room DB so the next reconnect can resume.
      removeRoomFiles(this.dataDir, this.sessionId);
    }
  }

  hasActiveSessions(): boolean {
    return this.room.getNumActiveSessions() > 0;
  }

  async flushSnapshotForShutdown(): Promise<void> {
    await this.maybePushSnapshot(true);
  }

  private closeActiveSockets(reason: string): void {
    // Snapshot entries to avoid mutating the Map during for..of iteration.
    // ws.close() schedules the close event for the next microtask, so
    // handleClose won't fire until after this method returns — but the
    // in-loop delete() would still mutate the Map during iteration.
    const entries = [...this.activeSockets];
    this.activeSockets.clear();
    this.sessionMetaIndex.clear();
    for (const [, ws] of entries) {
      try {
        ws.close(1000, reason);
      } catch {
        // already closed
      }
    }
  }

  private handleHostDeparture(): void {
    const hasHost = this.room
      .getSessions()
      .some((s) => s.meta.role === "host");
    if (hasHost) return;

    if (this.hostDepartureTimer) {
      clearTimeout(this.hostDepartureTimer);
    }

    const GRACE_PERIOD_MS = 5000;
    console.info(
      `[Room ${this.sessionId}] All hosts left — waiting ${GRACE_PERIOD_MS}ms grace period before auto-approving`
    );

    this.hostDepartureTimer = setTimeout(() => {
      this.hostDepartureTimer = null;

      if (this.room.getSessions().some((s) => s.meta.role === "host")) return;

      console.info(
        `[Room ${this.sessionId}] Grace period elapsed — promoting next host (pending requests kept pending)`
      );

      this.promoteNextActingManager();
    }, GRACE_PERIOD_MS);
  }

  private handleActingManagerDeparture(): void {
    this.actingManagerId = null;
    this.persistActingManager();

    const hasHost = this.room
      .getSessions()
      .some((s) => s.meta.role === "host");
    if (hasHost) return;

    this.promoteNextActingManager();
  }

  private promoteNextActingManager(): void {
    if (this.actingManagerId !== null) return;

    const sessions = this.room.getSessions();
    if (sessions.length === 0) {
      this.actingManagerId = null;
      this.persistActingManager();
      return;
    }

    if (sessions.some((s) => s.meta.role === "host")) return;

    const approvedSession = sessions.find((s) =>
      this.canvasEditorUserIds.has(s.meta.userId)
    );
    const nonGuestSession = sessions.find((s) => s.meta.role !== "guest");
    const nextHost = approvedSession ?? nonGuestSession;
    if (!nextHost) {
      this.actingManagerId = null;
      this.persistActingManager();
      return;
    }

    this.actingManagerId = nextHost.meta.userId;

    if (!this.canvasEditorUserIds.has(nextHost.meta.userId)) {
      this.canvasEditorUserIds.add(nextHost.meta.userId);
      this.canvasEditorGrantedAt.set(nextHost.meta.userId, Date.now());
      for (const session of sessions) {
        if (session.meta.userId === nextHost.meta.userId) {
          this.sendCustomMessageIfConnected(session.sessionId, {
            type: WHITEBOARD_EVENTS.ACCESS_GRANTED,
          });
        }
      }
      this.scheduleCanvasAccessReconnect(nextHost.meta.userId);
    }

    this.persistCanvasEditorGrants();
    this.persistActingManager();
    console.info(
      `[Room ${this.sessionId}] Assigned ${nextHost.meta.userName} (${nextHost.meta.userId}) as acting whiteboard manager`
    );
  }

  private broadcastWhiteboardState(): void {
    const sessions = this.room.getSessions();
    const editorUserIds = [...this.canvasEditorUserIds];
    const pendingList = [...this.pendingEditorRequests.values()];

    const hostIds = new Set<string>();
    for (const session of sessions) {
      if (session.meta.role === "host") {
        hostIds.add(session.meta.userId);
      }
    }

    const allEditorUserIds = [...new Set([...hostIds, ...editorUserIds])];

    // Deduplicated connected-user list sent only to managers so they can hand off navigation.
    const connectedUsersMap = new Map<string, { userId: string; userName: string }>();
    for (const session of sessions) {
      if (!connectedUsersMap.has(session.meta.userId)) {
        connectedUsersMap.set(session.meta.userId, {
          userId: session.meta.userId,
          userName: session.meta.userName,
        });
      }
    }
    const connectedUsers = [...connectedUsersMap.values()];

    for (const session of sessions) {
      const isManager =
        session.meta.role === "host" ||
        session.meta.userId === this.actingManagerId;

      const state = {
        type: WHITEBOARD_EVENTS.STATE,
        editorUserIds: allEditorUserIds,
        pendingEditorRequests: isManager ? pendingList : [],
        editorCount: editorUserIds.length,
        actingManagerId: this.actingManagerId,
        aiPanelOpen: this.aiPanelOpen,
        navigationControllerUserId: this.navigationControllerUserId,
        navigationControllerName: this.navigationControllerName,
        pageNumber: this.currentSyncedPage,
        // Legacy fields retained until all clients are on the explicit capability names.
        writerUserIds: allEditorUserIds,
        writerCount: editorUserIds.length,
        promotedHostId: this.actingManagerId,
        presenterUserId: this.navigationControllerUserId,
        presenterName: this.navigationControllerName,
        pendingRequests: isManager ? pendingList : [],
        // Only managers need the full participant list to assign navigation control.
        connectedUsers: isManager ? connectedUsers : undefined,
      };

      this.sendCustomMessageIfConnected(session.sessionId, state);
    }
  }

  // ─── HTTP management methods ──────────────────────────────────────────

  requestCanvasEditAccess(userId: string, userName: string, role = "participant"): Response {
    const sessions = this.room.getSessions();
    const connectedSession = sessions.find((s) => s.meta.userId === userId);
    if (!connectedSession) {
      return Response.json({ error: "User is not connected" }, { status: 404 });
    }
    const effectiveRole = connectedSession.meta.role || role;
    const displayName = normalizeAccessRequestUserName(userName || connectedSession.meta.userName);

    // Guests must never be auto-granted canvas edit access.
    if (effectiveRole === "guest" && !sessions.some((s) => s.meta.role === "host") && !sessions.some((s) => s.meta.userId === this.actingManagerId)) {
      this.pendingEditorRequests.set(userId, {
        userId,
        userName: displayName,
      });
      this.broadcastWhiteboardState();
      return Response.json({ status: "pending_no_host" });
    }

    if (this.canvasEditorUserIds.has(userId)) {
      for (const session of this.room.getSessions()) {
        if (session.meta.userId === userId) {
          this.sendCustomMessageIfConnected(session.sessionId, {
            type: WHITEBOARD_EVENTS.ACCESS_GRANTED,
          });
        }
      }
      this.scheduleCanvasAccessReconnect(userId);
      this.broadcastWhiteboardState();
      return Response.json({ status: "already_approved" });
    }

    if (this.pendingEditorRequests.has(userId)) {
      return Response.json({ status: "already_pending" });
    }

    // cap pending requests to prevent unbounded growth
    if (this.pendingEditorRequests.size >= MAX_PENDING_REQUESTS) {
      return Response.json({ error: "Too many pending requests" }, { status: 429 });
    }

    const hasHost =
      sessions.some((s) => s.meta.role === "host") ||
      (this.actingManagerId !== null &&
        sessions.some((s) => s.meta.userId === this.actingManagerId));

    if (!hasHost) {
      // only non-guests can be auto-approved when no host is present
      if (effectiveRole === "guest") {
        this.pendingEditorRequests.set(userId, {
          userId,
          userName: displayName,
        });
        this.broadcastWhiteboardState();
        return Response.json({ status: "pending_no_host" });
      }

      this.canvasEditorUserIds.add(userId);
      this.canvasEditorGrantedAt.set(userId, Date.now());
      this.persistCanvasEditorGrants();

      for (const session of this.room.getSessions()) {
        if (session.meta.userId === userId) {
          this.sendCustomMessageIfConnected(session.sessionId, {
            type: WHITEBOARD_EVENTS.ACCESS_GRANTED,
          });
        }
      }
      this.scheduleCanvasAccessReconnect(userId);

      if (!this.actingManagerId && !this.room.getSessions().some((s) => s.meta.role === "host")) {
        this.promoteNextActingManager();
      }

      this.broadcastWhiteboardState();
      return Response.json({ status: "auto_approved" });
    }

    this.pendingEditorRequests.set(userId, {
      userId,
      userName: displayName,
    });

    this.broadcastWhiteboardState();

    for (const session of this.room.getSessions()) {
      if (session.meta.role === "host" || session.meta.userId === this.actingManagerId) {
        this.sendCustomMessageIfConnected(session.sessionId, {
          type: WHITEBOARD_EVENTS.ACCESS_REQUESTED,
          userId,
          userName: displayName,
        });
      }
    }

    return Response.json({ status: "pending" });
  }

  grantCanvasEditAccess(targetUserId: string, approverId: string): Response {
    if (!this.canManageWhiteboard(approverId)) {
      return Response.json(
        { error: "Only hosts can approve" },
        { status: 403 }
      );
    }

    this.pendingEditorRequests.delete(targetUserId);
    this.canvasEditorUserIds.add(targetUserId);
    this.canvasEditorGrantedAt.set(targetUserId, Date.now());
    this.persistCanvasEditorGrants();

    for (const session of this.room.getSessions()) {
      if (session.meta.userId === targetUserId) {
        this.sendCustomMessageIfConnected(session.sessionId, {
          type: WHITEBOARD_EVENTS.ACCESS_GRANTED,
        });
      }
    }
    this.scheduleCanvasAccessReconnect(targetUserId);

    this.broadcastWhiteboardState();
    return Response.json({ status: "approved" });
  }

  promoteActingManager(userId: string): Response {
    const sessions = this.room.getSessions();
    const targetSession = sessions.find((s) => s.meta.userId === userId);
    if (!targetSession) {
      return Response.json({ error: "Target user is not connected" }, { status: 404 });
    }

    this.actingManagerId = userId;
    this.canvasEditorUserIds.add(userId);
    this.canvasEditorGrantedAt.set(userId, Date.now());
    this.persistCanvasEditorGrants();
    this.persistActingManager();

    if (targetSession) {
      for (const session of sessions) {
        if (session.meta.userId === userId) {
          this.sendCustomMessageIfConnected(session.sessionId, {
            type: WHITEBOARD_EVENTS.ACCESS_GRANTED,
          });
        }
      }
      this.scheduleCanvasAccessReconnect(userId);
    }

    this.broadcastWhiteboardState();
    return Response.json({
      status: "acting_manager_promoted",
      actingManagerId: userId,
      promotedHostId: userId,
      connected: Boolean(targetSession),
    });
  }

  denyCanvasEditAccessRequest(targetUserId: string, approverId: string): Response {
    if (!this.canManageWhiteboard(approverId)) {
      return Response.json(
        { error: "Only hosts can deny" },
        { status: 403 }
      );
    }

    this.pendingEditorRequests.delete(targetUserId);

    for (const session of this.room.getSessions()) {
      if (session.meta.userId === targetUserId) {
        this.sendCustomMessageIfConnected(session.sessionId, {
          type: WHITEBOARD_EVENTS.ACCESS_DENIED,
          reason: "host_denied",
        });
      }
    }

    this.broadcastWhiteboardState();
    return Response.json({ status: "denied" });
  }

  revokeCanvasEditAccess(userId: string, requesterId: string | undefined): Response {
    if (!requesterId) {
      return Response.json(
        { error: "Missing requesterId" },
        { status: 400 }
      );
    }
    if (requesterId !== userId) {
      if (!this.canManageWhiteboard(requesterId)) {
        return Response.json(
          { error: "Only whiteboard managers can revoke another user's edit access" },
          { status: 403 }
        );
      }
    }

    this.canvasEditorUserIds.delete(userId);
    this.canvasEditorGrantedAt.delete(userId);
    this.pendingEditorRequests.delete(userId);
    this.persistCanvasEditorGrants();

    // clear actingManagerId when self-releasing to avoid inconsistent acting-host state
    if (requesterId === userId && this.actingManagerId === userId) {
      this.actingManagerId = null;
      this.persistActingManager();
    }

    for (const session of this.room.getSessions()) {
      if (session.meta.userId === userId) {
        this.sendCustomMessageIfConnected(session.sessionId, {
          type: WHITEBOARD_EVENTS.ACCESS_REVOKED,
        });
      }
    }
    this.scheduleCanvasAccessReconnect(userId);

    this.broadcastWhiteboardState();
    return Response.json({ status: "released" });
  }

  setNavigationController(targetUserId: string, approverId: string): Response {
    if (!this.canManageWhiteboard(approverId)) {
      return Response.json({ error: "Only whiteboard managers can assign navigation control" }, { status: 403 });
    }

    if (targetUserId === approverId) {
      return Response.json({ error: "Cannot hand off presenting to yourself" }, { status: 400 });
    }

    const targetSession = this.room.getSessions().find(
      (s) => s.meta.userId === targetUserId
    );
    if (!targetSession) {
      return Response.json({ error: "Target user is not connected" }, { status: 404 });
    }

    this.navigationControllerUserId = targetUserId;
    this.navigationControllerName = targetSession.meta.userName;

    this.broadcastWhiteboardState();
    return Response.json({ status: "navigation_controller_set", navigationControllerUserId: targetUserId });
  }

  releaseNavigationController(requesterId: string): Response {
    const isAuthorized = this.room.getSessions().some(
      (s) =>
        s.meta.userId === requesterId &&
        (s.meta.role === "host" ||
          requesterId === this.actingManagerId ||
          requesterId === this.navigationControllerUserId)
    );
    if (!isAuthorized) {
      return Response.json(
        { error: "Only whiteboard managers or the current navigation controller can release navigation control" },
        { status: 403 }
      );
    }

    this.navigationControllerUserId = null;
    this.navigationControllerName = null;

    this.broadcastWhiteboardState();
    return Response.json({ status: "navigation_controller_released" });
  }

  syncPage(userId: string, pageNumber: number, senderConnectionId?: string): Response {
    // When a navigation controller is active, only they can drive page navigation.
    // Otherwise, the whiteboard manager drives it.
    const isAuthorized = this.navigationControllerUserId
      ? userId === this.navigationControllerUserId
      : this.canManageWhiteboard(userId);
    if (!isAuthorized) {
      return Response.json(
        { error: "Only the navigation controller or whiteboard manager can sync pages" },
        { status: 403 }
      );
    }

    this.currentSyncedPage = Math.min(
      WHITEBOARD_CONFIG.MAX_PAGES,
      Math.max(1, Math.trunc(pageNumber))
    );
    this.persistCurrentPage();

    const msg = { type: WHITEBOARD_EVENTS.PAGE_SYNC, pageNumber: this.currentSyncedPage };
    for (const session of this.room.getSessions()) {
      // Skip the sender — they already navigated there
      if (senderConnectionId) {
        if (session.meta.connectionId === senderConnectionId) continue;
      } else if (session.meta.userId === userId) {
        continue;
      }
      this.sendCustomMessageIfConnected(session.sessionId, msg);
    }

    return Response.json({ status: "synced" });
  }

  async endSession(): Promise<Response> {
    if (this.ending) {
      return Response.json({ status: "ending" });
    }
    this.ending = true;

    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const session of this.room.getSessions()) {
      this.sendCustomMessageIfConnected(session.sessionId, {
        type: WHITEBOARD_EVENTS.SESSION_ENDING,
      });
    }

    this.canvasEditorUserIds.clear();
    this.canvasEditorGrantedAt.clear();
    this.pendingEditorRequests.clear();
    this.persistCanvasEditorGrants();

    const hasSnapshotCallback = Boolean(this.callbackUrl && this.callbackSecret);

    // Capture the final snapshot before any delayed work.
    // This ensures we have the data even if SIGTERM arrives during the
    // 2-second client drain window below.
    let finalSnapshot: unknown | null = null;
    let finalSnapshotPayload: { body: string; hash: string } | null = null;
    let finalSnapshotClock: number | null = null;
    if (hasSnapshotCallback) {
      try {
        finalSnapshot = this.room.getCurrentSnapshot();
        finalSnapshotClock = this.getSnapshotLastChangedClock(finalSnapshot);
        finalSnapshotPayload = await this.buildSnapshotPayload(finalSnapshot);
        if (finalSnapshotPayload) {
          this.persistPendingSnapshot(finalSnapshotPayload, {
            final: true,
            deleteRoomFilesOnSuccess: true,
          });
        }
      } catch (e) {
        console.error(`[Room ${this.sessionId}] Failed to capture final snapshot in endSession:`, e);
      }
    }

    // Push the final snapshot immediately (before the client-drain delay)
    // so SIGTERM during the 2s window cannot cause data loss.
    const snapshotPushPromise = hasSnapshotCallback && finalSnapshotPayload
      ? this.pushSnapshot(finalSnapshotPayload.body)
      : Promise.resolve({ ok: !hasSnapshotCallback, retryAfterMs: null as number | null });

    // Give clients 2 seconds to process the session.ending message and
    // drain pending CRDT messages before closing their sockets.
    setTimeout(() => {
      if (this.closed) return;
      this.closeActiveSockets("session ended");

      void (async () => {
        let deleteFiles = !hasSnapshotCallback;

        if (hasSnapshotCallback && finalSnapshotPayload) {
          const pushed = await snapshotPushPromise;
          if (pushed.ok) {
            this.resetSnapshotPushBackoff();
            this.lastPushedSnapshotPayloadHash = finalSnapshotPayload.hash;
            this.clearPendingSnapshot(finalSnapshotPayload.hash);
            if (
              finalSnapshotClock !== null &&
              finalSnapshotClock > this.lastPushedSnapshotClock
            ) {
              this.lastPushedSnapshotClock = finalSnapshotClock;
            }
            deleteFiles = true;
          }
        }

        if (hasSnapshotCallback && !deleteFiles) {
          console.warn(
            `[Room ${this.sessionId}] Final snapshot was not persisted; preserving room database files`
          );
        }

        this.close({ deleteFiles });
        this.onEmpty();
      })().catch((e) => {
        console.error(`[Room ${this.sessionId}] Failed to finalize ended session:`, e);
        if (!this.closed) {
          this.close({ deleteFiles: false });
          this.onEmpty();
        }
      });
    }, 2000);

    return Response.json({ status: "ending" });
  }

  getState(requesterId?: string): Response {
    if (requesterId && !this.canManageWhiteboard(requesterId)) {
      return Response.json({ error: "Only hosts can inspect whiteboard state" }, { status: 403 });
    }
    return Response.json({
      connections: this.room.getNumActiveSessions(),
      editorUserIds: [...this.canvasEditorUserIds],
      canvasEditorUserIds: [...this.canvasEditorUserIds],
      writerUserIds: [...this.canvasEditorUserIds],
      pendingEditorRequests: [...this.pendingEditorRequests.values()],
      actingManagerId: this.actingManagerId,
      promotedHostId: this.actingManagerId,
      navigationControllerUserId: this.navigationControllerUserId,
      navigationControllerName: this.navigationControllerName,
      presenterUserId: this.navigationControllerUserId,
      presenterName: this.navigationControllerName,
      pageNumber: this.currentSyncedPage,
    });
  }

  checkCanvasEditAccess(userId: string, role: string): Response {
    const connected = this.room.getSessions().some((session) => session.meta.userId === userId);
    const canEditCanvas = connected && this.canEditCanvas(userId, role);
    return Response.json({
      canEditCanvas,
      canWrite: canEditCanvas,
    });
  }

  private async pushSnapshot(body: string): Promise<{ ok: boolean; retryAfterMs: number | null }> {
    if (!this.callbackUrl || !this.callbackSecret) {
      return { ok: false, retryAfterMs: null };
    }
    try {
      const response = await fetch(this.callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Whiteboard-Secret": this.callbackSecret,
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const retryAfterMs = this.parseRetryAfterMs(response.headers.get("Retry-After"));
        const responseText = await response.text().catch(() => "");
        const errorSnippet = responseText.slice(0, 200);
        console.error(
          `[Room ${this.sessionId}] Snapshot push failed with status ${response.status}${errorSnippet ? `: ${errorSnippet}` : ""}`
        );
        return { ok: false, retryAfterMs };
      }
      console.info(`[Room ${this.sessionId}] Snapshot pushed to callback`);
      return { ok: true, retryAfterMs: null };
    } catch (e) {
      console.error(`[Room ${this.sessionId}] Failed to push snapshot:`, e);
      return { ok: false, retryAfterMs: null };
    }
  }

  setAiPanelState(open: boolean): void {
    this.aiPanelOpen = open;
  }

  storeAiChatMessage(message: { id: string; role: string; content: string; userName?: string; whiteboardAttached?: boolean }): void {
    // Update existing message or append new one
    const existingIdx = this.aiChatMessages.findIndex((m) => m.id === message.id);
    if (existingIdx >= 0) {
      this.aiChatMessages[existingIdx] = message;
    } else {
      this.aiChatMessages.push(message);
      // Cap the array size
      if (this.aiChatMessages.length > MAX_AI_CHAT_MESSAGES) {
        this.aiChatMessages = this.aiChatMessages.slice(-MAX_AI_CHAT_MESSAGES);
      }
    }
  }

  clearAiChatMessages(): void {
    this.aiChatMessages = [];
  }

  getAiChatHistory(): Response {
    return Response.json({ messages: this.aiChatMessages });
  }

  broadcastToAll(data: unknown, senderConnectionId?: string): Response {
    for (const session of this.room.getSessions()) {
      if (senderConnectionId && session.meta.connectionId === senderConnectionId) continue;
      this.sendCustomMessageIfConnected(session.sessionId, data);
    }
    return Response.json({ ok: true });
  }

  // role passed for API symmetry; audience restrictions use session meta instead
  canAcceptBroadcast(userId: string, _role: string, data: unknown): boolean {
    const messageType = getBroadcastMessageType(data);
    if (!messageType) return false;

    const audience = classifyBroadcastAudience(messageType);
    if (audience === null || audience === "server-only") {
      return false;
    }

    const sessions = this.room.getSessions();
    const userSessions = sessions.filter((session) => session.meta.userId === userId);
    if (userSessions.length === 0) {
      return false;
    }

    // per-user broadcast rate limiting
    if (!this.checkBroadcastRateLimit(userId)) {
      console.warn(`[Room ${this.sessionId}] Broadcast rate limited for user ${userId}`);
      return false;
    }

    if (audience === "participant") {
      return true;
    }

    if (audience === "whiteboard-manager") {
      return userSessions.some(
        (session) => session.meta.role === "host" || session.meta.userId === this.actingManagerId
      );
    }

    // "canvas-edit": user must be a host, acting manager, or granted canvas editor.
    return userSessions.some(
      (session) =>
        session.meta.userId === this.actingManagerId ||
        this.canEditCanvas(session.meta.userId, session.meta.role)
    );
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private static readonly MAX_ROOMS = 500;
  private readonly staleRoomMaxAgeMs: number;
  private readonly pruneIntervalMs: number;
  private readonly callbackUrl?: string;
  private readonly callbackSecret?: string;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly dataDir: string,
    options?: {
      staleRoomMaxAgeMs?: number;
      pruneIntervalMs?: number;
      callbackUrl?: string;
      callbackSecret?: string;
    }
  ) {
    this.staleRoomMaxAgeMs = options?.staleRoomMaxAgeMs ?? 24 * 60 * 60 * 1000;
    this.pruneIntervalMs = options?.pruneIntervalMs ?? 60 * 60 * 1000;
    this.callbackUrl = options?.callbackUrl;
    this.callbackSecret = options?.callbackSecret;

    ensureRoomDataDir(this.dataDir);
    void this.flushPendingSnapshots("startup").catch((error) => {
      console.error("[RoomManager] Failed to flush pending snapshots on startup:", error);
    });
    this.pruneStaleRoomFiles("startup");

    this.pruneTimer = setInterval(() => {
      void this.flushPendingSnapshots("interval")
        .catch((error) => {
          console.error("[RoomManager] Failed to flush pending snapshots:", error);
        })
        .finally(() => {
          this.pruneStaleRoomFiles("interval");
        });
    }, this.pruneIntervalMs);
  }

  get roomCount() {
    return this.rooms.size;
  }

  private async fetchPersistedSnapshot(sessionId: string): Promise<unknown | null> {
    if (!this.callbackUrl || !this.callbackSecret) return null;
    try {
      const url = new URL(this.callbackUrl);
      url.searchParams.set("sessionId", sessionId);
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: { "X-Whiteboard-Secret": this.callbackSecret },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 204 || response.status === 404) return null;
      if (!response.ok) {
        console.warn(`[RoomManager] Snapshot fetch returned ${response.status} for ${sessionId}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.warn(`[RoomManager] Failed to fetch persisted snapshot for ${sessionId}:`, error);
      return null;
    }
  }

  async prepareRoom(sessionId: string): Promise<void> {
    if (this.rooms.has(sessionId)) return;
    if (roomStorageInitialized(this.dataDir, sessionId)) return;
    const snapshot = await this.fetchPersistedSnapshot(sessionId);
    if (snapshot === null) return;
    this.getOrCreateRoom(sessionId, snapshot);
  }

  private parseRetryAfterMs(retryAfterHeader: string | null): number | null {
    if (!retryAfterHeader) return null;
    const asSeconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds * 1000;
    const asDate = Date.parse(retryAfterHeader);
    if (Number.isNaN(asDate)) return null;
    return Math.max(0, asDate - Date.now());
  }

  private async pushPendingSnapshot(body: string): Promise<boolean> {
    if (!this.callbackUrl || !this.callbackSecret) return false;
    try {
      const response = await fetch(this.callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Whiteboard-Secret": this.callbackSecret,
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const retryAfterMs = this.parseRetryAfterMs(response.headers.get("Retry-After"));
        console.warn(
          `[RoomManager] Pending snapshot push returned ${response.status}${retryAfterMs ? ` retryAfterMs=${retryAfterMs}` : ""}`
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error("[RoomManager] Failed to push pending snapshot:", error);
      return false;
    }
  }

  private async flushPendingSnapshots(reason: "startup" | "interval"): Promise<void> {
    if (!this.callbackUrl || !this.callbackSecret) return;
    const files = readRoomDataDir(this.dataDir);
    if (!files) return;

    for (const file of files) {
      if (!file.endsWith(".db.snapshot.json")) continue;
      const snapshotPath = `${this.dataDir}/${file}`;
      const pending = readPendingSnapshotFile(snapshotPath, file);
      if (!pending) continue;

      if (!pending.sessionId || !pending.body || !pending.hash) {
        console.error(`[RoomManager] Ignoring malformed pending snapshot ${file}`);
        continue;
      }

      if (this.rooms.has(pending.sessionId)) continue;

      const pushed = await this.pushPendingSnapshot(pending.body);
      if (!pushed) continue;

      deleteFileIfExists(snapshotPath);
      if (pending.deleteRoomFilesOnSuccess) {
        removeRoomFiles(this.dataDir, pending.sessionId);
      }
      console.info(`[RoomManager] Flushed pending snapshot (${reason}): ${pending.sessionId}`);
    }
  }

  private pruneStaleRoomFiles(reason: "startup" | "interval"): void {
    const cutoff = Date.now() - this.staleRoomMaxAgeMs;

    const files = readRoomDataDir(this.dataDir);
    if (!files) return;

    for (const file of files) {
      if (!file.endsWith(".db")) continue;

      const sessionId = file.slice(0, -3);
      if (this.rooms.has(sessionId)) continue;
      if (hasPendingSnapshot(this.dataDir, file)) continue;

      const dbPath = `${this.dataDir}/${file}`;
      try {
        const newestMtimeMs = getNewestRoomDbMtimeMs(dbPath);
        if (newestMtimeMs >= cutoff) continue;
      } catch {
        continue;
      }

      removeRoomFiles(this.dataDir, sessionId);
      console.info(
        `[RoomManager] Pruned stale room DB (${reason}): ${sessionId}`
      );
    }
  }

  getOrCreateRoom(sessionId: string, initialSnapshot?: unknown): Room {
    let room = this.rooms.get(sessionId);
    if (!room) {
      if (this.rooms.size >= RoomManager.MAX_ROOMS) {
        throw new Error("Maximum concurrent whiteboard rooms reached");
      }
      room = new Room(sessionId, this.dataDir, () => {
        this.rooms.delete(sessionId);
        console.info(`[RoomManager] Room ${sessionId} cleaned up`);
      }, this.callbackUrl, this.callbackSecret, initialSnapshot);
      this.rooms.set(sessionId, room);
    }
    return room;
  }

  closeRoomIfEmpty(sessionId: string): void {
    const room = this.rooms.get(sessionId);
    if (!room || room.hasActiveSessions()) return;
    room.close({ deleteFiles: false });
    this.rooms.delete(sessionId);
  }

  getRoomIfExists(sessionId: string): Room | null {
    return this.rooms.get(sessionId) ?? null;
  }

  async closeAll(): Promise<void> {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }

    await Promise.allSettled(
      [...this.rooms.values()].map((room) => room.flushSnapshotForShutdown())
    );

    for (const room of this.rooms.values()) {
      room.close({ deleteFiles: false });
    }
    this.rooms.clear();
  }
}
