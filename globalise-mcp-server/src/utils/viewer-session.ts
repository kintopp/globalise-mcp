/**
 * Viewer command-queue session state for the LLM→viewer reverse channel
 * (plan 021, rijksmuseum-mcp-plus `src/registration/state.ts` parity).
 *
 * The view tool mints a viewUUID and a server-side command queue; the iframe
 * polls `globalise_poll_viewer_commands` and drains it; `globalise_navigate_viewer`
 * and the inspect tool's auto-zoom push commands into it.
 *
 * MODULE SCOPE IS LOAD-BEARING: in stateless HTTP mode a fresh McpServer is
 * built per request (createServer() runs per request), so the queues MUST live
 * outside createServer() — otherwise every request would start with an empty
 * map and the reverse channel would never see a mint from a prior request.
 * Same pattern as this repo's SQLite handles and LRU caches. (Per-process
 * state: fine for the single Railway/Desktop process; would break under
 * multiple replicas — see the plan's maintenance notes.)
 */

import { randomUUID } from 'node:crypto';

/** A command the iframe drains and executes; also the navigate_viewer input shape. */
export interface ViewerCommand {
  action: 'navigate';
  region?: string;
  relativeTo?: string;
  relativeToSize?: CropLocalSize;
}

/** Actual pixel dimensions of an inspected crop (for crop-local coordinates). */
export interface CropLocalSize {
  width: number;
  height: number;
}

export interface ViewerQueue {
  commands: ViewerCommand[];
  createdAt: number;
  lastAccess: number;
  lastPolledAt?: number;
  documentId: string;
  imageWidth?: number;
  imageHeight?: number;
}

/** Delete entries idle longer than ttlMs as of `now`. */
export function evictIdle<T extends { lastAccess: number }>(map: Map<string, T>, ttlMs: number, now: number): void {
  for (const [id, entry] of map) {
    if (now - entry.lastAccess > ttlMs) map.delete(id);
  }
}

/**
 * Run evictIdle every 60s (default TTL 30 min). The interval is `.unref()`d so
 * it never holds the process open (a bare setInterval would keep the event
 * loop alive and hang a graceful exit).
 */
export function sweepTtlMap<T extends { lastAccess: number }>(map: Map<string, T>, ttlMs = 1_800_000): void {
  setInterval(() => evictIdle(map, ttlMs, Date.now()), 60_000).unref();
}

export const viewerQueues = new Map<string, ViewerQueue>();
sweepTtlMap(viewerQueues);

/**
 * Mint a session, or — when `requested` is a live UUID (in-viewer page
 * navigation) — remount it: identity, createdAt and pending commands kept,
 * content swapped. lastPolledAt is left alone because the iframe is already
 * polling this UUID. A stale (TTL-evicted) UUID silently mints a fresh one;
 * the viewer adopts whatever comes back.
 */
export function mintOrRemount(
  requested: string | undefined,
  documentId: string,
  dims?: CropLocalSize,
): string {
  const now = Date.now();
  const existing = requested ? viewerQueues.get(requested) : undefined;
  if (requested && existing) {
    existing.documentId = documentId;
    existing.imageWidth = dims?.width;
    existing.imageHeight = dims?.height;
    existing.lastAccess = now;
    return requested;
  }
  const viewUUID = randomUUID();
  viewerQueues.set(viewUUID, {
    commands: [],
    createdAt: now,
    lastAccess: now,
    documentId,
    imageWidth: dims?.width,
    imageHeight: dims?.height,
  });
  return viewUUID;
}

/** Hand the iframe every queued command and empty the queue; an unknown UUID drains nothing. */
export function drainQueue(viewUUID: string): ViewerCommand[] {
  const queue = viewerQueues.get(viewUUID);
  if (!queue) return [];
  queue.lastAccess = Date.now();
  queue.lastPolledAt = queue.lastAccess;
  return queue.commands.splice(0);
}
