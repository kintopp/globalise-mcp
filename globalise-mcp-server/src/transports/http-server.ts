/**
 * HTTP transport for MCP server
 *
 * Streamable HTTP in stateless mode: every POST /mcp gets a fresh server
 * instance and a fresh transport (sessionIdGenerator: undefined), both torn
 * down when the response closes. No session IDs, no session maps, nothing to
 * expire — and immune to proxies killing long-lived connections or clients
 * caching stale session IDs.
 */

import type { Server } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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

/**
 * Create and start the HTTP server. Returns the underlying http.Server so the
 * caller can drain it on shutdown — discarding it (and returning the express
 * app) meant SIGTERM had no handle to close, cutting in-flight requests on
 * every redeploy (CODE-REVIEW finding 5).
 */
export function createHttpServer(options: HttpServerOptions): Server {
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
   * POST /mcp - Handle MCP requests
   *
   * Stateless: fresh server + transport per request, closed when the
   * response ends. Initialize requests get no session ID, so clients
   * never send one back; every request is self-contained.
   */
  app.post('/mcp', originGuard, async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    res.on('close', () => {
      // Fire-and-forget teardown: a rejected close must not become an
      // unhandledRejection (fatal on Node 24); there is nothing to recover.
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
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

  return server;
}
