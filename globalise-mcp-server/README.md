# GLOBALISE MCP Server

An MCP server for searching and retrieving ~4.8M transcribed pages from the Dutch East India Company (VOC) archives, provided by the [GLOBALISE project](https://globalise.huygens.knaw.nl/).

## Tools

| Tool | Purpose |
|------|---------|
| `globalise_search_transcriptions` | Full-text search across all transcriptions, with inventory and language filters (incl. `matchAll` for bilingual documents) |
| `globalise_retrieve_document` | Retrieve a document by ID |
| `globalise_navigate` | Browse to next/previous page |
| `globalise_find_archival_documents` | Query 228K+ archival document indexes |
| `globalise_view_document_ui` | Interactive viewer with page scan and transcription |

## Resources

| URI | Description |
|-----|-------------|
| `ui://globalise/document-viewer.html` | MCP Apps document viewer (HTML, served to host iframes) |

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRANSPORT` | `stdio` | `http` for Streamable HTTP mode |
| `PORT` | `3000` | HTTP port |
| `MCP_ALLOWED_ORIGINS` | claude.ai/claude.com/chatgpt.com | Origin allowlist for `/mcp` (exact origins or `*.domain` globs; `*` disables) |
| `STRUCTURED_CONTENT` | `true` | Set `false` to strip `outputSchema`/`structuredContent` for clients that reject them (MSTY, Jan.ai) |

## Quick Start

**Hosted instance** (no setup required):
```
https://globalise-mcp-production.up.railway.app/mcp
```

**Local (stdio):**
```bash
npm run build && node dist/index.js
```

**Local (HTTP):**
```bash
TRANSPORT=http PORT=3000 node dist/index.js
```

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "globalise": {
      "command": "node",
      "args": ["/absolute/path/to/globalise-mcp-server/dist/index.js"]
    }
  }
}
```

## Development

```bash
npm run build       # Build everything (UI, TypeScript, archival DB)
npm run dev         # Watch mode
npm run inspector   # Test with MCP Inspector
```

## Project Structure

```
src/
├── index.ts                 # Entry point, tool/resource definitions
├── tools/                   # Tool implementations
├── resources/               # MCP resource definitions
├── transports/http-server.ts
└── utils/                   # API client, cache, types
apps/
└── document-viewer/         # Interactive viewer (Vite SPA)
```

## License

MIT
