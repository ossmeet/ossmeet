import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { NodeSqliteWrapper, SQLiteSyncStorage } from "@tldraw/sync-core";
import type { PendingSnapshotFile } from "./room-types";

export function ensureRoomDataDir(dataDir: string): void {
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch (error) {
    console.error(`[RoomManager] Failed to create data dir ${dataDir}:`, error);
  }
}

export function removeRoomFiles(dataDir: string, sessionId: string): void {
  const basePath = `${dataDir}/${sessionId}.db`;
  try { unlinkSync(basePath); } catch { /* file may not exist */ }
  try { unlinkSync(basePath + "-wal"); } catch { /* file may not exist */ }
  try { unlinkSync(basePath + "-shm"); } catch { /* file may not exist */ }
  try { unlinkSync(basePath + ".snapshot.json"); } catch { /* file may not exist */ }
}

export function roomStorageInitialized(dataDir: string, sessionId: string): boolean {
  const db = new Database(`${dataDir}/${sessionId}.db`);
  try {
    const sql = new NodeSqliteWrapper(db);
    return SQLiteSyncStorage.hasBeenInitialized(sql);
  } finally {
    db.close();
  }
}

export function readRoomDataDir(dataDir: string): string[] | null {
  try {
    return readdirSync(dataDir);
  } catch (error) {
    console.error(`[RoomManager] Failed to read data dir ${dataDir}:`, error);
    return null;
  }
}

export function readPendingSnapshotFile(snapshotPath: string, fileName: string): PendingSnapshotFile | null {
  try {
    return JSON.parse(readFileSync(snapshotPath, "utf8")) as PendingSnapshotFile;
  } catch (error) {
    console.error(`[RoomManager] Failed to read pending snapshot ${fileName}:`, error);
    return null;
  }
}

export function deleteFileIfExists(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // File may have been removed by another cleanup path.
  }
}

export function hasPendingSnapshot(dataDir: string, file: string): boolean {
  return existsSync(`${dataDir}/${file}.snapshot.json`);
}

export function getNewestRoomDbMtimeMs(dbPath: string): number {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].reduce((newest, path) => {
    try {
      return Math.max(newest, statSync(path).mtimeMs);
    } catch {
      return newest;
    }
  }, 0);
}
