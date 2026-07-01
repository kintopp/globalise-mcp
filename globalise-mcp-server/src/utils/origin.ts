/**
 * Origin validation middleware for MCP endpoints.
 *
 * The MCP spec (2025-11-25, Streamable HTTP transport) requires servers to
 * validate the Origin header as a DNS-rebinding mitigation and to respond
 * with HTTP 403 Forbidden for invalid origins.
 *
 * Category rules:
 * - Missing Origin, non-web schemes (app://, chrome-extension://, file://,
 *   vscode-webview://, ...), and the literal "null" origin are always allowed
 *   (covers stdio-wrapping clients, desktop apps, sandboxed iframes).
 * - localhost / 127.0.0.1 / [::1] / *.localhost are always allowed (local dev).
 * - http(s) origins must match the MCP_ALLOWED_ORIGINS allowlist: exact
 *   origins (https://claude.ai) or hostname globs (*.claude.ai). The value
 *   "*" disables the check entirely.
 * - Everything else is denied with 403 and a rate-limited log line.
 */

import { Request, Response, NextFunction } from 'express';

/** Default allowlist: known MCP hosts. Override with MCP_ALLOWED_ORIGINS. */
const DEFAULT_ALLOWED_ORIGINS = [
  'https://claude.ai',
  '*.claude.ai',
  'https://claude.com',
  '*.claude.com',
  'https://chatgpt.com',
  '*.chatgpt.com',
  'https://chat.openai.com',
];

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** One deny log line per origin per minute, so a misbehaving client can't flood logs. */
const DENY_LOG_INTERVAL_MS = 60_000;

/**
 * Check an http(s) origin against an allowlist entry.
 * - "*.example.com" matches example.com and any subdomain (any scheme).
 * - Anything else is an exact, case-insensitive origin match.
 */
function matchesEntry(origin: string, hostname: string, entry: string): boolean {
  if (entry.startsWith('*.')) {
    const domain = entry.slice(2).toLowerCase();
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }
  return origin.toLowerCase() === entry.toLowerCase();
}

/**
 * Create the Express middleware. Logs the effective policy once at creation.
 */
export function createOriginGuard() {
  const env = process.env.MCP_ALLOWED_ORIGINS;
  const allowlist = env
    ? env.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;
  const disabled = allowlist.includes('*');
  const lastDenyLog = new Map<string, number>();

  if (disabled) {
    console.error('[ORIGIN] Validation DISABLED (MCP_ALLOWED_ORIGINS=*)');
  } else {
    console.error(`[ORIGIN] Allowed origins: ${allowlist.join(', ')} (+ localhost, non-web schemes)`);
  }

  /** Rate-limited deny: log at most once per origin per minute, then 403. */
  const deny = (origin: string, res: Response): void => {
    const now = Date.now();
    const last = lastDenyLog.get(origin) ?? 0;
    if (now - last > DENY_LOG_INTERVAL_MS) {
      // Origins are attacker-controlled, so bound the map; the occasional
      // duplicate log line after a reset is harmless
      if (lastDenyLog.size >= 1000) lastDenyLog.clear();
      lastDenyLog.set(origin, now);
      console.error(`[ORIGIN] Denied request from disallowed origin: ${origin}`);
    }
    res.status(403).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Forbidden: origin not allowed',
      },
      id: null,
    });
  };

  return function originGuard(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers.origin;

    // No Origin header (curl, stdio wrappers, server-to-server) or sandboxed "null"
    if (!origin || origin === 'null' || disabled) {
      next();
      return;
    }

    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      // A value URL() rejects is normally a non-web scheme from a desktop shell
      // (app://-, vscode-webview://…), which we allow. But an http(s)-looking
      // origin that still won't parse is malformed — a real browser never emits
      // one — so don't fail open on it: deny rather than wave it through.
      if (/^https?:/i.test(origin)) {
        deny(origin, res);
        return;
      }
      next();
      return;
    }

    // Non-web schemes: desktop apps, extensions, local files
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      next();
      return;
    }

    const hostname = url.hostname.toLowerCase();

    if (LOCALHOST_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
      next();
      return;
    }

    if (allowlist.some((entry) => matchesEntry(origin, hostname, entry))) {
      next();
      return;
    }

    deny(origin, res);
  };
}
