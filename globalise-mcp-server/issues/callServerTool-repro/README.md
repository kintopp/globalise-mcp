# `app.callServerTool()` Issue #32 Reproduction

Minimal reproduction case for [anthropics/claude-ai-mcp#32](https://github.com/anthropics/claude-ai-mcp/issues/32).

## The Issue

When an MCP App calls `app.callServerTool()` from the UI, Claude Desktop returns a JSON-RPC validation error instead of executing the tool.

## Setup

1. Install dependencies and build:
```bash
cd examples/callServerTool-repro
npm install
npm run build
```

2. Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "callServerTool-repro": {
      "command": "node",
      "args": ["/path/to/globalise-mcp-server/examples/callServerTool-repro/dist/server.js"]
    }
  }
}
```

3. Restart Claude Desktop

## Reproduction Steps

1. Ask Claude: "Use the echo_message tool with message 'test'"
2. The MCP App UI will appear
3. Click the "Call echo_message" button in the UI
4. Observe the error in the log panel

## Expected Behavior

The `echo_message` tool should execute and return "Echo: Hello from UI!"

## Actual Behavior

Claude Desktop returns:
```
Invalid JSON-RPC message received: [{"code":"invalid_union","unionErrors":[
  {"issues":[{"code":"invalid_type","expected":"object","received":"string","path":["params"],"message":"Expected object, received string"}],"name":"ZodError"},
  {"issues":[{"code":"invalid_type","expected":"object","received":"string","path":["params"],"message":"Expected object, received string"},{"code":"unrecognized_keys","keys":["id"],"path":[],"message":"Unrecognized key(s) in object: 'id'"}],"name":"ZodError"},
  ...
]}]
```

## Files

- `server.ts` - Minimal MCP server with one tool (`echo_message`) and one UI resource
- `app.html` - Minimal MCP App that calls `app.callServerTool()` on button click

## Environment

- Claude Desktop: January 2026
- MCP SDK: @modelcontextprotocol/sdk@1.10.1
- MCP Apps SDK: @modelcontextprotocol/ext-apps@1.0.1
- macOS
