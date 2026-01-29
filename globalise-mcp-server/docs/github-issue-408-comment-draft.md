# Draft Comment for GitHub Issue #408

**Issue:** https://github.com/modelcontextprotocol/typescript-sdk/issues/408

**Status:** Draft - waiting until issues are fully resolved

---

## Workaround for Session Initialization Race Condition

We encountered a related issue where HTTP clients (ChatGPT, MSTY) would fail on the **first** tool call but succeed on retry, with error `-32000: Connection closed`.

### Root Cause
Clients sending `initialize` + `tools/call` requests in parallel (or near-parallel). The tool call arrives before initialization completes, hitting the "Server not initialized" check.

### Solution
Use `onsessioninitialized` callback + two-phase session storage:

```typescript
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

const streamableSessions = new Map<string, StreamableHTTPServerTransport>();  // Initialized
const pendingTransports = new Map<string, StreamableHTTPServerTransport>();   // Pending init

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Check initialized sessions first
  if (sessionId && streamableSessions.has(sessionId)) {
    const transport = streamableSessions.get(sessionId)!;
    return transport.handleRequest(req, res, req.body);
  }

  // Check pending sessions
  if (sessionId && pendingTransports.has(sessionId)) {
    const transport = pendingTransports.get(sessionId)!;
    return transport.handleRequest(req, res, req.body);
  }

  // New session - check if it's an init request
  const messages = Array.isArray(req.body) ? req.body : [req.body];
  const hasInitRequest = messages.some(isInitializeRequest);

  if (!hasInitRequest && !sessionId) {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Session required. Send InitializeRequest first.' },
      id: null,
    });
  }

  const newSessionId = sessionId || randomUUID();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => newSessionId,
    onsessioninitialized: (id) => {
      // Move from pending to active only after init completes
      const t = pendingTransports.get(id);
      if (t) {
        pendingTransports.delete(id);
        streamableSessions.set(id, t);
      }
    },
  });

  pendingTransports.set(newSessionId, transport);
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
```

### Key Points
1. Store new sessions in `pendingTransports` until `onsessioninitialized` fires
2. Reject non-init requests without session ID with a clear error
3. Check both maps when looking up existing sessions

Full implementation: https://github.com/kintopp/globalise-mcp/blob/main/globalise-mcp-server/src/transports/http-server.ts
