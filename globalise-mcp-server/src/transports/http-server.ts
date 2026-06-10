/**
 * HTTP transport for MCP server
 *
 * Streamable HTTP in stateless mode: every POST /mcp gets a fresh server
 * instance and a fresh transport (sessionIdGenerator: undefined), both torn
 * down when the response closes. No session IDs, no session maps, nothing to
 * expire — and immune to proxies killing long-lived connections or clients
 * caching stale session IDs.
 *
 * The legacy SSE transport (/sse + /messages) is retained for backward
 * compatibility; each SSE connection gets its own server instance. Slated
 * for removal (refactor item R5).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { createOriginGuard } from '../utils/origin.js';

const VERSION = '1.25.0';

export interface HttpServerOptions {
  port?: number;
  /** CORS allowlist for browser-facing routes (response headers only). */
  allowedOrigins?: string[];
  /** Factory producing a fully configured MCP server, called per connection. */
  createServer: () => McpServer;
}

/**
 * Create and start the HTTP server.
 */
export function createHttpServer(options: HttpServerOptions) {
  const { port = 3000, allowedOrigins = ['*'], createServer } = options;

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
      name: 'globalise-mcp-server',
      version: VERSION,
      transports: {
        streamableHttp: {
          endpoint: '/mcp',
          status: 'active (stateless)',
          description: 'Recommended for new integrations',
        },
        sse: {
          endpoint: '/sse',
          status: 'active (legacy)',
          description: 'For backward compatibility',
        },
      },
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
   * GET /mcp - no server-initiated notification stream in stateless mode
   * (spec-legal: servers MAY return 405 for GET on the MCP endpoint).
   */
  app.get('/mcp', originGuard, (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method Not Allowed: this server runs stateless Streamable HTTP (POST only)',
      },
      id: null,
    });
  });

  /**
   * DELETE /mcp - nothing to terminate in stateless mode.
   */
  app.delete('/mcp', originGuard, (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method Not Allowed: stateless server, no sessions to terminate',
      },
      id: null,
    });
  });

  // ==========================================================================
  // Legacy SSE Transport (Backward Compatibility)
  // ==========================================================================

  const sseSessions = new Map<string, SSEServerTransport>();

  /**
   * GET /sse - Establish SSE connection (legacy)
   * Each connection gets its own server instance (one transport per server).
   */
  app.get('/sse', originGuard, async (_req: Request, res: Response) => {
    console.error('[SSE] New legacy SSE connection (consider using /mcp instead)');

    const server = createServer();
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;

    sseSessions.set(sessionId, transport);

    transport.onclose = () => {
      console.error(`[SSE] Connection closed: ${sessionId}`);
      sseSessions.delete(sessionId);
      server.close();
    };

    try {
      await server.connect(transport);
    } catch (error) {
      console.error('[SSE] Error connecting transport:', error);
      sseSessions.delete(sessionId);
    }
  });

  /**
   * POST /messages - Handle SSE client messages (legacy)
   */
  app.post('/messages', originGuard, async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId query parameter required' });
      return;
    }

    const transport = sseSessions.get(sessionId);

    if (!transport) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }

    try {
      await transport.handleMessage(req.body);
      res.status(200).send();
    } catch (error) {
      console.error('[SSE] Error handling message:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Start Server
  // ==========================================================================

  app.listen(port, () => {
    console.error('='.repeat(65));
    console.error('[HTTP] GLOBALISE MCP Server started');
    console.error(`[HTTP] Version: ${VERSION}`);
    console.error(`[HTTP] Listening on: http://localhost:${port}`);
    console.error('='.repeat(65));
    console.error('[HTTP] Endpoints:');
    console.error('');
    console.error('  Streamable HTTP (recommended, stateless):');
    console.error(`    POST   http://localhost:${port}/mcp`);
    console.error('');
    console.error('  Legacy SSE (backward compatible):');
    console.error(`    GET    http://localhost:${port}/sse`);
    console.error(`    POST   http://localhost:${port}/messages?sessionId=<id>`);
    console.error('');
    console.error('  Health check:');
    console.error(`    GET    http://localhost:${port}/health`);
    console.error('='.repeat(65));
    console.error(`[HTTP] CORS: ${allowedOrigins.join(', ')}`);
    console.error('='.repeat(65));
  });

  return app;
}
