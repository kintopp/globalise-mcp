/**
 * HTTP transport for MCP server
 *
 * Stateless Streamable HTTP: createMcpHandler serves both 2025-era and
 * 2026-07-28 clients on POST /mcp, building a fresh server per request. No
 * session IDs, no session maps, nothing to expire — and immune to proxies
 * killing long-lived connections or clients caching stale session IDs.
 */

import type { Server } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { createOriginGuard } from '../utils/origin.js';

export interface HttpServerOptions {
  port?: number;
  /** CORS allowlist for browser-facing routes (response headers only). */
  allowedOrigins?: string[];
  /** Server name reported by /health. */
  name?: string;
  /** Server version reported by /health and the startup log (git-tag derived). */
  version?: string;
  /** Deployed commit (short SHA) reported by /health. */
  commit?: string;
  /** Factory producing a fully configured MCP server, called per connection. */
  createServer: () => McpServer;
}

export interface HttpServerHandle {
  server: Server;
  /** Ends long-lived MCP streams (2026-07-28 subscriptions/listen) that would block server.close(). */
  closeMcp: () => Promise<void>;
}

/**
 * Create and start the HTTP server. Returns the http.Server and the MCP close
 * hook so the caller can drain both on shutdown.
 */
export function createHttpServer(options: HttpServerOptions): HttpServerHandle {
  const { port = 3000, allowedOrigins = ['*'], name = 'mcp-server', version = 'unknown', commit = 'unknown', createServer } = options;

  const app = express();

  // Behind Railway's proxy: required so express (and the SDK's rate limiter)
  // reads the client IP from X-Forwarded-For instead of throwing
  app.set('trust proxy', 1);

  // Middleware
  // cors() only emits `Access-Control-Allow-Origin: *` when origin is the STRING
  // '*'; an array containing '*' is an exact-membership list that matches no real
  // browser origin. Collapse a wildcard allowlist to the string form.
  const corsOrigin = allowedOrigins.includes('*') ? '*' : allowedOrigins;
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  // Origin validation on MCP endpoints (spec MUST: 403 on invalid origins).
  // Separate from CORS, which only sets response headers and rejects nothing.
  const originGuard = createOriginGuard();

  // Default legacy: 'stateless' keeps 2025-era clients working — don't set 'reject'.
  const mcpHandler = createMcpHandler(createServer, {
    onerror: (error) => console.error('[MCP] Error handling request:', error),
  });
  const handleMcp = toNodeHandler(mcpHandler, {
    onerror: (error) => console.error('[MCP] adapter error:', error),
  });

  // ==========================================================================
  // Health Check Endpoint
  // ==========================================================================

  app.get('/health', originGuard, (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      // `server`/`commit` mirror the sibling rijksmuseum-mcp+ health shape so a
      // single probe reads uniformly across deployments. `version` is the git
      // tag of the running release; `commit` is the exact deployed SHA (so drift
      // between a tag and prod's auto-deployed HEAD is visible by comparison).
      server: name,
      version,
      commit,
      // Surfaces the runtime the platform actually selected, so the deployed
      // Node version is verifiable via curl (the build pins Node 24 through
      // package.json "engines" + .nvmrc, but Railway's builder ultimately
      // chooses the patch). Expected: v24.x on Railway and in Claude Desktop.
      node: process.version,
    });
  });

  // ==========================================================================
  // Archival index download (thin-.mcpb support)
  // ==========================================================================

  // Serves the committed compressed finding-aid index so thin .mcpb installs
  // can fetch it from this deployment instead of a GitHub release asset —
  // release-download URLs 404 while the repo is private, this route does not.
  // The .gz ships in the deploy (it is the build's own DB source), so there is
  // nothing extra to provision. sendFile handles ETag/ranges; the gzip is the
  // payload itself, not transport encoding, hence the explicit content-type.
  const archivalGzPath = fileURLToPath(new URL('../../data/archival-index.sqlite.gz', import.meta.url));
  app.get('/archival-index.sqlite.gz', originGuard, (_req: Request, res: Response) => {
    if (!existsSync(archivalGzPath)) {
      res.status(404).json({ error: 'archival-index.sqlite.gz is not present on this deployment' });
      return;
    }
    res.sendFile(archivalGzPath, {
      headers: { 'Content-Type': 'application/gzip' },
    });
  });

  // ==========================================================================
  // Streamable HTTP Transport (stateless)
  // ==========================================================================

  /**
   * POST /mcp - Handle MCP requests (both protocol eras)
   *
   * Stateless: the handler builds a fresh server per request and tears it
   * down when the response ends. No session IDs; every request is
   * self-contained.
   */
  app.post('/mcp', originGuard, async (req: Request, res: Response) => {
    try {
      await handleMcp(req, res, req.body);
    } catch (error) {
      console.error('[MCP] Error handling request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  /**
   * GET /mcp (no server-initiated notification stream in stateless mode) and
   * DELETE /mcp (no sessions to terminate) both get a JSON-RPC 405
   * (spec-legal: servers MAY return 405 for these on the MCP endpoint).
   */
  const methodNotAllowed = (message: string) => (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json({
      jsonrpc: '2.0',
      error: { code: -32000, message },
      id: null,
    });
  };

  app.get('/mcp', originGuard, methodNotAllowed('Method Not Allowed: this server runs stateless Streamable HTTP (POST only)'));
  app.delete('/mcp', originGuard, methodNotAllowed('Method Not Allowed: stateless server, no sessions to terminate'));

  // ==========================================================================
  // Start Server
  // ==========================================================================

  const server = app.listen(port, () => {
    console.error('='.repeat(65));
    console.error('[HTTP] GLOBALISE MCP Server started');
    console.error(`[HTTP] Version: ${version} (commit ${commit})`);
    console.error(`[HTTP] Listening on: http://localhost:${port}`);
    console.error('[HTTP] Endpoints:');
    console.error(`[HTTP]   POST http://localhost:${port}/mcp     (Streamable HTTP, stateless)`);
    console.error(`[HTTP]   GET  http://localhost:${port}/health`);
    console.error(`[HTTP]   GET  http://localhost:${port}/archival-index.sqlite.gz`);
    console.error(`[HTTP] CORS: ${allowedOrigins.join(', ')}`);
    console.error('='.repeat(65));
  });

  return { server, closeMcp: () => mcpHandler.close() };
}
