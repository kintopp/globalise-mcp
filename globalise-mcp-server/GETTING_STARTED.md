# Getting Started with GLOBALISE MCP Server

This guide will help you set up the GLOBALISE MCP server to search Dutch East India Company (VOC) historical transcriptions using your preferred AI assistant.

## What is an MCP Server?

The Model Context Protocol (MCP) is a standard that allows AI assistants like Claude to use external tools. This MCP server gives your AI assistant the ability to search through 4.8 million pages of historical VOC documents.

Once connected, you can ask questions like:
- "Search for documents mentioning pepper trade in Batavia"
- "Find all Persian language documents in the archive"
- "Show me page 106 from inventory 9966"

## Prerequisites

Before starting, you'll need:

1. **Node.js** (version 18 or higher)
   - Check your version: `node --version`
   - Download from: https://nodejs.org/

2. **A compatible AI client** (see options below)

## Step 1: Download and Build the Server

Open your terminal and run:

```bash
# Clone the repository
git clone https://github.com/kintopp/globalise-mcp.git

# Navigate to the MCP server directory
cd globalise-mcp/globalise-mcp-server

# Install dependencies
npm install

# Build the server
npm run build
```

If successful, you'll see no errors and a `dist/` folder will be created.

## Step 2: Find Your Absolute Path

You'll need the full path to the server. Run this command:

```bash
# On macOS/Linux
echo "$(pwd)/dist/index.js"

# On Windows (PowerShell)
Write-Output "$pwd\dist\index.js"
```

Copy this path - you'll need it for configuration. It will look something like:
- macOS: `/Users/yourname/globalise-mcp/globalise-mcp-server/dist/index.js`
- Windows: `C:\Users\yourname\globalise-mcp\globalise-mcp-server\dist\index.js`

---

## Setup Instructions by Client

Choose your AI client below:

### Claude Desktop

Claude Desktop is Anthropic's desktop application for macOS and Windows.

**Step 1: Open the configuration file**

- **macOS**: Open Finder, press `Cmd+Shift+G`, and go to:
  ```
  ~/Library/Application Support/Claude/
  ```

- **Windows**: Press `Win+R` and enter:
  ```
  %APPDATA%\Claude\
  ```

**Step 2: Edit `claude_desktop_config.json`**

If the file doesn't exist, create it. Add or update with:

```json
{
  "mcpServers": {
    "globalise": {
      "command": "node",
      "args": ["/FULL/PATH/TO/globalise-mcp-server/dist/index.js"]
    }
  }
}
```

Replace `/FULL/PATH/TO/` with your actual path from Step 2 above.

**Step 3: Restart Claude Desktop**

Completely quit and reopen Claude Desktop (not just close the window).

**Step 4: Verify connection**

Look for a hammer icon (🔨) in the Claude Desktop interface. Click it to see the available GLOBALISE tools. If you don't see it, check the troubleshooting section below.

---

### Claude.ai (Web Interface)

Claude.ai requires the server to be accessible over HTTP. This means running it in HTTP mode and exposing it via a tunnel.

**Step 1: Start the server in HTTP mode**

```bash
TRANSPORT=http PORT=3000 node dist/index.js
```

You should see: `GLOBALISE MCP Server listening on port 3000`

**Step 2: Create a public tunnel**

In a new terminal, use ngrok (or similar):

```bash
# Install ngrok if needed: https://ngrok.com/download
ngrok http 3000
```

Copy the `https://` URL provided (e.g., `https://abc123.ngrok.io`).

**Step 3: Connect in Claude.ai**

1. Go to https://claude.ai
2. Open Settings (gear icon)
3. Navigate to "Integrations" or "MCP Servers" (may vary by account type)
4. Add a new MCP server
5. Enter your ngrok URL + `/mcp` (e.g., `https://abc123.ngrok.io/mcp`)

**Note:** Free ngrok URLs change each time you restart. Consider a paid ngrok plan for a stable URL, or deploy the server to a cloud provider.

---

### OpenAI ChatGPT

ChatGPT supports MCP servers in Developer Mode.

**Step 1: Start the server in HTTP mode**

```bash
TRANSPORT=http PORT=3000 node dist/index.js
```

**Step 2: Create a tunnel**

```bash
ngrok http 3000
```

Copy the HTTPS URL.

**Step 3: Configure ChatGPT**

1. Go to ChatGPT settings
2. Navigate to: **Settings → Connectors → Developer mode**
3. Click "Add MCP server"
4. Enter your ngrok URL + `/mcp`
5. Save and test

---

### MSTY

MSTY supports both stdio and HTTP transports.

**Option A: Stdio (Recommended)**

1. Open MSTY settings
2. Navigate to MCP server configuration
3. Add a new server with:
   - Command: `node`
   - Arguments: `/FULL/PATH/TO/dist/index.js`

**Option B: HTTP**

1. Start server: `TRANSPORT=http PORT=3000 node dist/index.js`
2. In MSTY, add server URL: `http://localhost:3000/mcp`

---

### Jan.ai

Jan.ai supports MCP servers via stdio.

**Step 1: Find Jan's settings**

Open Jan.ai and navigate to Settings → Extensions or MCP configuration.

**Step 2: Add the server**

Configure with:
- Command: `node`
- Arguments: Path to `dist/index.js`

**Known Issue:** Jan.ai's HTTP MCP support is experimental and may have tool execution bugs. Stdio transport is recommended.

---

### Claude Code (CLI)

If you're using Claude Code (Anthropic's CLI tool), you can add the MCP server to your project or global configuration.

**Project-level (recommended):**

Create or edit `.claude/settings.json` in your project:

```json
{
  "mcpServers": {
    "globalise": {
      "command": "node",
      "args": ["/FULL/PATH/TO/globalise-mcp-server/dist/index.js"]
    }
  }
}
```

**Global level:**

Add to `~/.config/claude/settings.json` (macOS/Linux) or `%APPDATA%\claude\settings.json` (Windows).

---

## Testing Your Setup

Once connected, try these example queries:

**Basic search:**
> "Search for documents mentioning 'pepper' in the GLOBALISE archive"

**Language-specific:**
> "Find Portuguese language documents in the VOC archives"

**Document retrieval:**
> "Get the document with ID NL-HaNA_1.04.02_9966_0106"

**Navigation:**
> "Show me the next page after that document"

---

## Troubleshooting

### "Server not found" or no hammer icon in Claude Desktop

1. **Check your path**: Make sure the path in your config file is correct and absolute
2. **Check the build**: Run `npm run build` again and ensure there are no errors
3. **Check Node.js**: Run `node --version` to ensure Node.js is installed
4. **Restart completely**: Quit Claude Desktop entirely (not just close the window) and reopen

### "Connection refused" errors

1. **Check if server is running**: For HTTP mode, ensure the terminal shows the server is listening
2. **Check the port**: Make sure port 3000 isn't used by another application
3. **Check firewall**: Ensure your firewall allows connections on the configured port

### "Tool execution failed" errors

1. **Check internet connection**: The server needs to reach the GLOBALISE API
2. **Try a simpler query**: Start with `globalise_search_transcriptions` with just `query: "peper"`
3. **Check the server logs**: Look at the terminal where the server is running for error messages

### Testing with MCP Inspector

For debugging, use the built-in inspector:

```bash
npm run inspector
```

This opens a web interface where you can:
- See all available tools
- Test tool calls manually
- View request/response details

---

## Next Steps

Once your setup is working:

1. **Explore the tools**: Ask your AI assistant "What GLOBALISE tools are available?"
2. **Read the main README**: See `README.md` for detailed documentation on all features
3. **Learn query syntax**: Boolean operators, wildcards, and fuzzy matching are supported
4. **Explore the archive**: Start searching! The corpus contains 4.8 million pages of history

---

## Getting Help

- **GitHub Issues**: https://github.com/kintopp/globalise-mcp/issues
- **MCP Documentation**: https://modelcontextprotocol.io/
- **GLOBALISE Project**: https://globalise.huygens.knaw.nl/

---

## Quick Reference

| Client | Transport | Configuration |
|--------|-----------|---------------|
| Claude Desktop | stdio | `claude_desktop_config.json` |
| Claude.ai | HTTP + tunnel | Settings → Integrations |
| ChatGPT | HTTP + tunnel | Settings → Connectors → Developer mode |
| MSTY | stdio or HTTP | Settings → MCP |
| Jan.ai | stdio | Settings → Extensions |
| Claude Code | stdio | `.claude/settings.json` |
