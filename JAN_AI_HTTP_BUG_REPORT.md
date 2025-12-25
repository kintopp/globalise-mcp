# Jan.ai MCP HTTP Transport Bug Report

**Date:** 2024-12-25
**Jan.ai Version:** (Please fill in version tested)
**MCP Server:** GLOBALISE MCP Server v1.5.0
**Issue:** HTTP transport connects successfully but fails to execute tools

---

## Summary

Jan.ai's experimental MCP HTTP transport can successfully:
- ✅ Connect to MCP servers via Streamable HTTP (`/mcp` endpoint)
- ✅ List available tools
- ❌ **Execute tool calls** (fails silently on server side, shows API error to user)

The same MCP server works perfectly with stdio transport in Jan.ai, and with HTTP transport in MSTY and ChatGPT.

---

## Expected Behavior

When a user asks a question that requires tool use (e.g., "what documents are available in persian"):

1. Jan.ai should call the appropriate MCP tool via HTTP POST
2. MCP server should receive the tool call and execute it
3. MCP server should return results as JSON text content
4. Jan.ai should forward results to the LLM
5. LLM should respond with an answer

---

## Actual Behavior

1. Jan.ai connects to MCP server successfully
2. Jan.ai lists tools successfully
3. **User asks question requiring tool use**
4. **MCP server never receives tool call** (no logs show tool execution)
5. Jan.ai shows error: `"messages: text content blocks must be non-empty"`

---

## Error Message

```
Error: 400 {
  "type":"error",
  "error":{
    "type":"invalid_request_error",
    "message":"messages: text content blocks must be non-empty"
  },
  "request_id":"req_011CWT2YG74i8WUc2gA1heNR"
}
```

This is an Anthropic API error, indicating Jan.ai is sending an empty or malformed message to Claude's API.

---

## Environment

- **MCP Server:** GLOBALISE MCP Server v1.5.0
- **Transport:** Streamable HTTP (MCP SDK `@modelcontextprotocol/sdk`)
- **Endpoint:** `https://<ngrok-url>/mcp`
- **MCP SDK Version:** Latest (December 2024)
- **Node.js:** v22+ (tested)

---

## Steps to Reproduce

1. **Start the GLOBALISE MCP server in HTTP mode:**
   ```bash
   cd globalise-mcp-server
   TRANSPORT=http PORT=3000 node dist/index.js
   ```

2. **Expose via ngrok:**
   ```bash
   ngrok http 3000
   ```

3. **Configure Jan.ai:**
   - Add MCP server
   - Transport Type: HTTP
   - URL: `https://<ngrok-url>/mcp`

4. **Test connection:**
   - Jan.ai should connect successfully
   - Tools should appear in tool list ✅

5. **Ask a question requiring tool use:**
   - Example: "what documents are available in persian"
   - Example: "what documents contain the word 'windmolen'"

6. **Observe error:**
   - Jan.ai shows: `"messages: text content blocks must be non-empty"`
   - MCP server logs show NO tool execution attempts

---

## Server Logs (HTTP Mode)

```
[MCP] New Streamable HTTP session: e6dff97c-a12d-41ae-8ad9-bf096507dcda
[MCP] Reusing session: e6dff97c-a12d-41ae-8ad9-bf096507dcda
[MCP] SSE stream requested for session: e6dff97c-a12d-41ae-8ad9-bf096507dcda
[MCP] Reusing session: e6dff97c-a12d-41ae-8ad9-bf096507dcda
[MCP] Reusing session: e6dff97c-a12d-41ae-8ad9-bf096507dcda
... (multiple session reuses, but NO tool calls logged)
```

**Expected logs if tool call succeeded:**
```
[TOOL] globalise_search_by_language - Response length: 1234 chars
```

**Observation:** Server receives session management requests but never receives `tools/call` requests.

---

## Jan.ai Logs

From Jan.ai's debug logs:

```
[2025-12-25 08:26:36.976] [info] (tools) Server capabilities globalise-mcp { tools: {} }
```

Note: `{ tools: {} }` is normal MCP behavior - it indicates the server supports the tools capability. The actual tool list comes from a separate `tools/list` request.

**Key observation:** No logs show Jan.ai attempting to call tools via HTTP.

---

## Comparison: HTTP (Broken) vs Stdio (Working)

### Stdio Transport (Working)

Same MCP server, stdio mode:
```json
{
  "mcpServers": {
    "globalise-voc": {
      "command": "node",
      "args": ["<path>/globalise-mcp-server/dist/index.js"]
    }
  }
}
```

**Result:** ✅ Jan.ai successfully executes tools and returns results.

### HTTP Transport (Broken)

Same MCP server, HTTP mode via ngrok:
- URL: `https://<ngrok-url>/mcp`
- Transport: HTTP

**Result:** ❌ Jan.ai connects but never calls tools.

---

## Working Clients (For Comparison)

The same MCP server works perfectly with:

| Client | Transport | Tool Execution | Notes |
|--------|-----------|----------------|-------|
| Claude Desktop | stdio | ✅ | Official MCP reference client |
| MSTY | HTTP (`/mcp`) | ✅ | Claude, GPT-4o tested |
| ChatGPT | HTTP (`/mcp`) | ✅ | Via ngrok tunnel |
| MCP Inspector | HTTP/SSE | ✅ | Official debugging tool |
| Jan.ai | stdio | ✅ | Same server, different transport |
| Jan.ai | HTTP | ❌ | **This bug** |

---

## Technical Analysis

### MCP Protocol Flow (Expected)

1. **Initialize:** Client → `initialize` request → Server
2. **List Tools:** Client → `tools/list` → Server returns tool schemas
3. **Call Tool:** Client → `tools/call` with arguments → Server executes → Returns content
4. **Result:** Client sends tool result to LLM

### What's Happening (Observed)

1. ✅ Initialize succeeds
2. ✅ tools/list succeeds
3. ❌ **tools/call never sent to server**
4. ❌ Jan.ai shows empty message error

### Hypothesis

Jan.ai's HTTP transport implementation may have a bug in the tool calling logic:
- Tool listing works (static schema retrieval)
- Tool execution fails (dynamic request/response handling)
- Error suggests Jan.ai is trying to send results to Claude but has empty content

**Possible causes:**
1. Jan.ai not sending `tools/call` requests over HTTP
2. Jan.ai sending malformed `tools/call` requests (server rejects silently)
3. Jan.ai receiving responses but failing to parse/handle them
4. Session management issue in HTTP mode (stdio works fine)

---

## Suggested Investigation Areas

1. **Check tool call request generation in HTTP transport:**
   - Is Jan.ai actually sending `tools/call` POST requests?
   - Compare with stdio transport tool calling logic

2. **Review MCP SDK integration:**
   - Verify Jan.ai is using `@modelcontextprotocol/sdk` correctly
   - Check if HTTP client transport is properly initialized

3. **Debug session management:**
   - HTTP uses session IDs (`mcp-session-id` header)
   - Stdio uses direct communication
   - Possible session tracking bug?

4. **Add debug logging:**
   - Log all HTTP requests sent to MCP servers
   - Log tool call attempts and responses
   - Compare with stdio transport logs

---

## Workaround

**For users:** Use stdio transport instead of HTTP for Jan.ai:

```json
{
  "mcpServers": {
    "globalise-voc": {
      "command": "node",
      "args": ["<path>/globalise-mcp-server/dist/index.js"]
    }
  }
}
```

Stdio transport works perfectly and is more secure for local use.

---

## Test Server (For Developers)

If Jan.ai developers want to test against our working MCP server:

**GitHub:** https://github.com/globalise-huygens/globalise-mcp
**Server:** `globalise-mcp-server/` directory
**Installation:**
```bash
cd globalise-mcp-server
npm install
npm run build
```

**Run in HTTP mode:**
```bash
TRANSPORT=http PORT=3000 node dist/index.js
```

**Run in stdio mode (working with Jan.ai):**
```bash
node dist/index.js
```

**Available tools:**
- `globalise_search_transcriptions` - Full-text search
- `globalise_retrieve_document` - Get document by ID
- `globalise_navigate` - Navigate between pages
- `globalise_search_by_inventory` - Search within inventory
- `globalise_search_by_language` - Language-specific search

---

## Contact

For questions about this bug report or the MCP server implementation:
- GitHub Issues: https://github.com/globalise-huygens/globalise-mcp/issues
- MCP Server tested with: Claude Desktop, MSTY, ChatGPT, MCP Inspector (all working)

---

## Additional Notes

- Jan.ai's MCP support is marked as experimental - we appreciate the work on MCP integration!
- This is constructive feedback to help improve HTTP transport compatibility
- Stdio transport works excellently - no issues there
- We're happy to provide additional logs or testing assistance if needed
