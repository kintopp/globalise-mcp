# GLOBALISE MCP

MCP server and API documentation for accessing the [GLOBALISE Transcriptions Viewer](https://transcriptions.globalise.huygens.knaw.nl/) - a corpus of approximately 4.8 million machine-generated transcriptions of Dutch East India Company (VOC) historical documents.

## Repository Contents

### [`globalise-mcp-server/`](./globalise-mcp-server/)

A production-ready Model Context Protocol (MCP) server providing 5 tools for searching and retrieving VOC transcriptions.

**Features:**
- Search transcriptions with full-text queries, filters, and aggregations
- Retrieve document details with metadata, annotations, and IIIF image URLs
- Navigate between pages within inventories
- Filter by language (Dutch, Portuguese, Spanish, French, Malay, and more)
- Filter by inventory number

**Supported Transports:**
- **Stdio** - For Claude Desktop and local integrations
- **Streamable HTTP** - For OpenAI ChatGPT, remote access, and web clients

**Tested With:**
- Claude Desktop
- OpenAI ChatGPT (via ngrok tunnel)
- MSTY
- Jan.ai

See the [MCP server README](./globalise-mcp-server/README.md) for installation and configuration.

### [`globalise-transcriptions-api/`](./globalise-transcriptions-api/)

Complete documentation of the GLOBALISE Transcriptions Viewer REST API, including:

- [API Reference](./globalise-transcriptions-api/API_REFERENCE.md) - Endpoints, parameters, and examples
- [Query Syntax](./globalise-transcriptions-api/QUERY_SYNTAX.md) - Boolean operators, wildcards, fuzzy matching
- [Data Models](./globalise-transcriptions-api/DATA_MODELS.md) - Response structures and field definitions
- [OpenAPI Specification](./globalise-transcriptions-api/openapi.yaml) - Machine-readable API spec

## Quick Start

```bash
# Clone the repository
git clone https://github.com/kintopp/globalise-mcp.git
cd globalise-mcp/globalise-mcp-server

# Install dependencies and build
npm install
npm run build

# Run with stdio (for Claude Desktop)
node dist/index.js

# Or run with HTTP transport (for ChatGPT/remote access)
TRANSPORT=http PORT=3000 node dist/index.js
```

## About GLOBALISE

The [GLOBALISE project](https://globalise.huygens.knaw.nl/) is digitizing and making accessible the archives of the Dutch East India Company (VOC), one of the most extensive colonial archives in the world. The transcriptions are machine-generated using Handwritten Text Recognition (HTR) and are freely available under CC0.

**Citation:** When using the transcriptions, please cite:
> NL-HaNA, VOC, [inv.nr.], [scan nr.], transcription GLOBALISE project (https://globalise.huygens.knaw.nl/), March 2024

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

The GLOBALISE transcriptions themselves are licensed under [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (Creative Commons Zero).
