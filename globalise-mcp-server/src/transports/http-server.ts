/**
 * HTTP transport for MCP server
 * Supports both Streamable HTTP (recommended) and SSE (legacy)
 *
 * Session Lifecycle:
 * 1. Client sends InitializeRequest (no session ID)
 * 2. Server creates transport, stores in pendingTransports
 * 3. After initialize completes, onsessioninitialized moves to streamableSessions
 * 4. Subsequent requests use mcp-session-id header to reuse session
 *
 * This prevents race conditions where tool calls arrive before initialization completes.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

const VERSION = '1.23.0';

export interface HttpServerOptions {
  port?: number;
  allowedOrigins?: string[];
}

/**
 * Create and start an HTTP server with both Streamable HTTP and SSE transports
 *
 * @param mcpServer The MCP server instance to connect
 * @param options Configuration options (port, CORS origins)
 */
export function createHttpServer(
  mcpServer: Server,
  options: HttpServerOptions = {}
) {
  const { port = 3000, allowedOrigins = ['*'] } = options;

  const app = express();

  // Middleware
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: '1mb' }));

  // Session storage for both transports
  // - streamableSessions: fully initialized sessions ready for tool calls
  // - pendingTransports: sessions being initialized (prevent race conditions)
  const streamableSessions = new Map<string, StreamableHTTPServerTransport>();
  const pendingTransports = new Map<string, StreamableHTTPServerTransport>();
  const sseSessions = new Map<string, SSEServerTransport>();

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
          status: 'active',
          description: 'Recommended for new integrations'
        },
        sse: {
          endpoint: '/sse',
          status: 'active (legacy)',
          description: 'For backward compatibility'
        }
      },
      activeSessions: {
        streamableHttp: streamableSessions.size,
        streamableHttpPending: pendingTransports.size,
        sse: sseSessions.size
      }
    });
  });

  // ==========================================================================
  // Streamable HTTP Transport (Recommended)
  // Single /mcp endpoint handling POST, GET, DELETE
  // ==========================================================================

  /**
   * POST /mcp - Handle MCP requests
   * Creates new session or uses existing one via mcp-session-id header
   *
   * Session lifecycle:
   * 1. InitializeRequest (no session ID): creates pending transport
   * 2. onsessioninitialized callback: moves to streamableSessions
   * 3. Tool calls (with session ID): uses initialized session
   *
   * This prevents race conditions where tool calls arrive before initialization.
   */
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    let transport: StreamableHTTPServerTransport;

    // Case 1: Existing initialized session
    if (sessionId && streamableSessions.has(sessionId)) {
      transport = streamableSessions.get(sessionId)!;
      console.error(`[MCP] Reusing initialized session: ${sessionId}`);
    }
    // Case 2: Session exists but still pending initialization
    else if (sessionId && pendingTransports.has(sessionId)) {
      transport = pendingTransports.get(sessionId)!;
      console.error(`[MCP] Reusing pending session: ${sessionId}`);
    }
    // Case 3: New session needed
    else {
      // Parse request body to check if this is an initialization request
      const body = req.body;
      const messages = Array.isArray(body) ? body : [body];
      const hasInitRequest = messages.some(isInitializeRequest);

      if (!hasInitRequest && !sessionId) {
        // Non-init request without session ID - client error
        console.error('[MCP] Rejected: tool call without session (client must initialize first)');
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Session required. Send InitializeRequest first.',
          },
          id: null,
        });
        return;
      }

      // Create new session (for init request, or stale session recovery)
      const newSessionId = sessionId || randomUUID();

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        // Callback when initialization completes - move from pending to active
        onsessioninitialized: (initializedSessionId: string) => {
          const t = pendingTransports.get(initializedSessionId);
          if (t) {
            pendingTransports.delete(initializedSessionId);
            streamableSessions.set(initializedSessionId, t);
            console.error(`[MCP] Session initialized: ${initializedSessionId}`);
          }
        },
      });

      // Store in pending while initialization happens
      pendingTransports.set(newSessionId, transport);

      if (sessionId) {
        console.error(`[MCP] Auto-recovering stale session: ${sessionId}`);
      } else {
        console.error(`[MCP] New session (pending init): ${newSessionId}`);
      }

      // Register cleanup BEFORE connecting (in case connect fails/closes immediately)
      transport.onclose = () => {
        console.error(`[MCP] Session closed: ${newSessionId}`);
        pendingTransports.delete(newSessionId);
        streamableSessions.delete(newSessionId);
      };

      try {
        await mcpServer.connect(transport);
      } catch (error) {
        pendingTransports.delete(newSessionId);
        throw error;
      }
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  });

  /**
   * GET /mcp - SSE stream for server-initiated messages (notifications)
   * Requires mcp-session-id header
   *
   * Auto-recovery: If session doesn't exist, creates a new one with the same ID.
   */
  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string;

    if (!sessionId) {
      res.status(400).json({
        error: 'Missing mcp-session-id header',
        suggestion: 'First make a POST request to /mcp to establish a session'
      });
      return;
    }

    // Check both initialized and pending sessions
    let transport = streamableSessions.get(sessionId) || pendingTransports.get(sessionId);

    // Auto-recover stale session for SSE stream
    if (!transport) {
      console.error(`[MCP] Auto-recovering stale session for SSE: ${sessionId}`);

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
        onsessioninitialized: (initializedSessionId: string) => {
          const t = pendingTransports.get(initializedSessionId);
          if (t) {
            pendingTransports.delete(initializedSessionId);
            streamableSessions.set(initializedSessionId, t);
            console.error(`[MCP] Session initialized (SSE recovery): ${initializedSessionId}`);
          }
        },
      });

      await mcpServer.connect(transport);
      pendingTransports.set(sessionId, transport);

      transport.onclose = () => {
        console.error(`[MCP] Session closed: ${sessionId}`);
        pendingTransports.delete(sessionId);
        streamableSessions.delete(sessionId);
      };
    }

    console.error(`[MCP] SSE stream requested for session: ${sessionId}`);
    await transport.handleRequest(req, res);
  });

  /**
   * DELETE /mcp - Terminate a session
   * Requires mcp-session-id header
   */
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string;

    if (!sessionId) {
      res.status(400).json({ error: 'Missing mcp-session-id header' });
      return;
    }

    const transport = streamableSessions.get(sessionId) || pendingTransports.get(sessionId);

    if (!transport) {
      res.status(404).json({ error: 'Session not found', sessionId });
      return;
    }

    console.error(`[MCP] Terminating session: ${sessionId}`);
    await transport.close();
    streamableSessions.delete(sessionId);
    pendingTransports.delete(sessionId);
    res.status(200).json({ message: 'Session terminated', sessionId });
  });

  // ==========================================================================
  // Legacy SSE Transport (Backward Compatibility)
  // ==========================================================================

  /**
   * GET /sse - Establish SSE connection (legacy)
   */
  app.get('/sse', async (req: Request, res: Response) => {
    console.error('[SSE] New legacy SSE connection (consider using /mcp instead)');

    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;

    sseSessions.set(sessionId, transport);

    transport.onclose = () => {
      console.error(`[SSE] Connection closed: ${sessionId}`);
      sseSessions.delete(sessionId);
    };

    try {
      await mcpServer.connect(transport);
    } catch (error) {
      console.error('[SSE] Error connecting transport:', error);
      sseSessions.delete(sessionId);
    }
  });

  /**
   * POST /messages - Handle SSE client messages (legacy)
   */
  app.post('/messages', async (req: Request, res: Response) => {
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
    console.error('  Streamable HTTP (recommended):');
    console.error(`    POST   http://localhost:${port}/mcp`);
    console.error(`    GET    http://localhost:${port}/mcp  (SSE notifications)`);
    console.error(`    DELETE http://localhost:${port}/mcp  (terminate session)`);
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
