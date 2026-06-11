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
  /** Server version reported by /health and the startup log. */
  version?: string;
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
  const { port = 3000, allowedOrigins = ['*'], name = 'mcp-server', version = 'unknown', createServer } = options;

  const app = express();

  // Behind Railway's proxy: required so express (and the SDK's rate limiter)
  // reads the client IP from X-Forwarded-For instead of throwing
  app.set('trust proxy', 1);

  // Middleware
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: '1mb' }));

  // Origin validation on MCP endpoints (spec MUST: 403 on invalid origins).
  // Separate from CORS, which only sets response headers and rejects nothing.
  const originGuard = createOriginGuard();

  // ==========================================================================
  // Health Check Endpoint
  // ==========================================================================

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      name,
      version,
      // Surfaces the runtime the platform actually selected, so the deployed
      // Node version is verifiable via curl (the build pins Node 24 through
      // package.json "engines" + .nvmrc, but Railway's builder ultimately
      // chooses the patch). Expected: v24.x on Railway and in Claude Desktop.
      node: process.version,
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
      transport.close();
      server.close();
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
    console.error(`[HTTP] Version: ${version}`);
    console.error(`[HTTP] Listening on: http://localhost:${port}`);
    console.error('[HTTP] Endpoints:');
    console.error(`[HTTP]   POST http://localhost:${port}/mcp     (Streamable HTTP, stateless)`);
    console.error(`[HTTP]   GET  http://localhost:${port}/health`);
    console.error(`[HTTP] CORS: ${allowedOrigins.join(', ')}`);
    console.error('='.repeat(65));
  });

  return server;
}
