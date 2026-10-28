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
import type { CropLocalSize } from './iiif.js';

/** A command the iframe drains and executes; also the navigate_viewer input shape. */
export interface ViewerCommand {
  action: 'navigate';
  region?: string;
  relativeTo?: string;
  relativeToSize?: CropLocalSize;
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
function sweepTtlMap<T extends { lastAccess: number }>(map: Map<string, T>, ttlMs = 1_800_000): void {
  setInterval(() => evictIdle(map, ttlMs, Date.now()), 60_000).unref();
}

export const viewerQueues = new Map<string, ViewerQueue>();
sweepTtlMap(viewerQueues);

export const MAX_VIEWER_SESSIONS = 1000;
export const MAX_PENDING_COMMANDS = 20;

/** Implicit by-document discovery is safe only when one process serves one user (stdio). */
export function implicitViewerDiscoveryAllowed(): boolean {
  return (process.env.TRANSPORT || 'stdio') !== 'http';
}

/**
 * The viewer an inspect call should steer: the requested UUID when it is live
 * and shows this document; otherwise — only when `allowImplicit` — the most
 * recently used queue for the document. Over shared HTTP the implicit branch
 * would pick another user's viewer and hand back its UUID.
 */
export function resolveActiveViewer(
  documentId: string,
  requested: string | undefined,
  allowImplicit: boolean,
): string | undefined {
  if (requested) {
    const q = viewerQueues.get(requested);
    if (!q || q.documentId !== documentId) return undefined;
    q.lastAccess = Date.now();
    return requested;
  }
  if (!allowImplicit) return undefined;
  let best: string | undefined;
  let bestLastAccess = -Infinity;
  for (const [uuid, q] of viewerQueues) {
    // `>=`: a later insertion in the same millisecond wins.
    if (q.documentId === documentId && q.lastAccess >= bestLastAccess) {
      best = uuid;
      bestLastAccess = q.lastAccess;
    }
  }
  if (best) viewerQueues.get(best)!.lastAccess = Date.now();
  return best;
}

/** Queue commands (refreshing lastAccess), dropping the oldest beyond MAX_PENDING_COMMANDS: only the latest zooms matter to an unpolled viewer. */
export function enqueueCommands(queue: ViewerQueue, ...commands: ViewerCommand[]): void {
  queue.commands.push(...commands);
  queue.lastAccess = Date.now();
  if (queue.commands.length > MAX_PENDING_COMMANDS) {
    queue.commands.splice(0, queue.commands.length - MAX_PENDING_COMMANDS);
  }
}

/** Evict least-recently-used sessions to make room for one more. */
function evictForNewSession(): void {
  if (viewerQueues.size < MAX_VIEWER_SESSIONS) return;
  let oldest: string | undefined;
  let oldestAccess = Infinity;
  for (const [uuid, q] of viewerQueues) {
    if (q.lastAccess < oldestAccess) {
      oldest = uuid;
      oldestAccess = q.lastAccess;
    }
  }
  if (oldest !== undefined) viewerQueues.delete(oldest);
}

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
  const content = { documentId, imageWidth: dims?.width, imageHeight: dims?.height, lastAccess: now };
  const existing = requested ? viewerQueues.get(requested) : undefined;
  if (existing) {
    Object.assign(existing, content);
    return requested!;
  }
  evictForNewSession();
  const viewUUID = randomUUID();
  viewerQueues.set(viewUUID, { commands: [], createdAt: now, ...content });
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
