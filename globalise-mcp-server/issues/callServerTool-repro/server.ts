/**
 * Minimal MCP Server for reproducing callServerTool() issue #32
 * https://github.com/anthropics/claude-ai-mcp/issues/32
 *
 * This server has:
 * - One tool: `echo_message` that echoes back input
 * - One UI resource for the MCP App
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import * as fs from 'fs';
import * as path from 'path';

const server = new Server(
  { name: 'callServerTool-repro', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } }
);

const RESOURCE_URI = 'ui://callServerTool-repro/app.html';

// List tools - _meta goes in the tool DEFINITION, not just the result
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo_message',
      description: 'Echoes back the message you send. Has a UI component.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          message: { type: 'string', description: 'Message to echo' },
        },
        required: ['message'],
      },
      // Link tool to its UI resource
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
        'ui/resourceUri': RESOURCE_URI, // Legacy format for older hosts
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'echo_message') {
    const { message } = request.params.arguments as { message: string };

    return {
      content: [
        { type: 'text', text: `Echo: ${message}` },
        { type: 'text', text: JSON.stringify({ message, timestamp: Date.now() }) },
      ],
    };
  }

  return { content: [{ type: 'text', text: 'Unknown tool' }], isError: true };
});

// List resources (the UI app)
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: RESOURCE_URI,
      name: 'Echo App UI',
      description: 'Minimal reproduction for callServerTool() issue',
      mimeType: RESOURCE_MIME_TYPE,
    },
  ],
}));

// Read resource (serve the HTML)
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === RESOURCE_URI) {
    // Go up from dist/ to find app.html in the source directory
    const htmlPath = path.join(import.meta.dirname, '..', 'app.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    return {
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          // CSP configuration for MCP Apps
          _meta: {
            ui: {
              csp: {
                resourceDomains: ['https://unpkg.com'], // ext-apps SDK
                connectDomains: [],
              },
            },
          },
        },
      ],
    };
  }

  throw new Error(`Resource not found: ${request.params.uri}`);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('callServerTool-repro server running on stdio');
}

main().catch(console.error);
