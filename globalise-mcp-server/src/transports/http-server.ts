/**
 * HTTP transport for MCP server
 * Supports both Streamable HTTP (recommended) and SSE (legacy)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

const VERSION = '1.12.0';

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
  app.use(express.json());

  // Session storage for both transports
  const streamableSessions = new Map<string, StreamableHTTPServerTransport>();
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
   * Auto-recovery: If client sends a stale session ID (e.g., after server restart),
   * we create a new session reusing the same ID so the client can continue seamlessly.
   */
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    let transport: StreamableHTTPServerTransport;

    if (sessionId && streamableSessions.has(sessionId)) {
      // Reuse existing session
      transport = streamableSessions.get(sessionId)!;
      console.error(`[MCP] Reusing session: ${sessionId}`);
    } else {
      // Create new session
      // If client sent a stale session ID, reuse it for seamless recovery
      // This handles server restarts gracefully - clients don't need to reinitialize
      const newSessionId = sessionId || randomUUID();

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      });

      if (sessionId) {
        console.error(`[MCP] Auto-recovering stale session: ${sessionId}`);
      } else {
        console.error(`[MCP] New Streamable HTTP session: ${newSessionId}`);
      }

      // Connect to MCP server
      await mcpServer.connect(transport);

      // Store session
      streamableSessions.set(newSessionId, transport);

      // Clean up on close
      transport.onclose = () => {
        console.error(`[MCP] Session closed: ${newSessionId}`);
        streamableSessions.delete(newSessionId);
      };
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

    let transport = streamableSessions.get(sessionId);

    // Auto-recover stale session for SSE stream
    if (!transport) {
      console.error(`[MCP] Auto-recovering stale session for SSE: ${sessionId}`);

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });

      await mcpServer.connect(transport);
      streamableSessions.set(sessionId, transport);

      transport.onclose = () => {
        console.error(`[MCP] Session closed: ${sessionId}`);
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

    const transport = streamableSessions.get(sessionId);

    if (!transport) {
      res.status(404).json({ error: 'Session not found', sessionId });
      return;
    }

    console.error(`[MCP] Terminating session: ${sessionId}`);
    await transport.close();
    streamableSessions.delete(sessionId);
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
