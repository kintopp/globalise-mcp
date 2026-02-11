# GLOBALISE MCP Server

An MCP server for searching and retrieving ~4.8M transcribed pages from the Dutch East India Company (VOC) archives, provided by the [GLOBALISE project](https://globalise.huygens.knaw.nl/).

## Tools

| Tool | Purpose |
|------|---------|
| `globalise_search_transcriptions` | Full-text search across all transcriptions |
| `globalise_retrieve_document` | Retrieve a document by ID |
| `globalise_navigate` | Browse to next/previous page |
| `globalise_search_by_inventory` | Search within a specific inventory |
| `globalise_search_by_language` | Find documents by language |
| `globalise_find_archival_documents` | Query 228K+ archival document indexes |
| `globalise_view_document_ui` | Interactive viewer with page scan and transcription |

## Resources

| URI | Description |
|-----|-------------|
| `globalise://help/query-syntax` | Query syntax reference |
| `globalise://reference/weights-measures` | VOC weights & measures glossary |
| `globalise://reference/commodities` | VOC commodities thesaurus |

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
