#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

function usage() {
  return [
    'Usage: kerf-mcp-bridge --url http://127.0.0.1:3919/mcp --token <token>',
    '',
    'The token may also be supplied through KERF_MCP_TOKEN.',
  ].join('\n');
}

function parseArgs(argv) {
  const result = {
    url: process.env.KERF_MCP_URL ?? '',
    token: process.env.KERF_MCP_TOKEN ?? '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (argument === '--url') {
      result.url = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (argument === '--token') {
      result.token = argv[index + 1] ?? '';
      index += 1;
    }
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));
if (!options.url || !options.token) {
  process.stderr.write(`${usage()}\n`);
  process.exit(2);
}

let client;
try {
  client = new Client(
    { name: 'kerf-mcp-bridge', version: '0.0.0' },
    { capabilities: {} },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(options.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${options.token}` },
      },
    }),
  );
} catch (cause) {
  process.stderr.write(
    `Could not reach the Kerf MCP server: ${
      cause instanceof Error ? cause.message : String(cause)
    }\n`,
  );
  process.exit(1);
}

const server = new Server(
  { name: 'kerf', version: '0.1.0' },
  {
    capabilities: { tools: {} },
    instructions: client.getInstructions(),
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const listed = await client.listTools();
  return { tools: listed.tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return await client.callTool({
      name: request.params.name,
      arguments: request.params.arguments ?? {},
    });
  } catch (cause) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Kerf bridge failed: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        },
      ],
    };
  }
});

const stdio = new StdioServerTransport();
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await stdio.close().catch(() => undefined);
  await client.close().catch(() => undefined);
  await server.close().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
stdio.onclose = () => {
  void shutdown();
};

try {
  await server.connect(stdio);
} catch (cause) {
  process.stderr.write(
    `Could not start the Kerf MCP bridge: ${
      cause instanceof Error ? cause.message : String(cause)
    }\n`,
  );
  process.exit(1);
}

// Keep the event loop alive while the stdio transport owns stdin.
await new Promise(() => undefined);
