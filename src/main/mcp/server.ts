import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { KERF_AGENT_SYSTEM_PROMPT } from '@kerf/agent';
import { toolRegistry } from '@kerf/tools';
import type { ToolService } from '../tools/service';

export interface McpServerHostOptions {
  readonly tools: Pick<ToolService, 'call'>;
  readonly host?: string;
  readonly port?: number;
  readonly version?: string;
}

interface Session {
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
}

const MCP_PATH = '/mcp';
const DEFAULT_PORT = 3919;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

/**
 * Builds the MCP surface from the same registry the built-in agent uses. There
 * is no second tool list to drift: every schema, description and read-only hint
 * comes from the shared catalog.
 */
export function createKerfMcpServer(
  tools: Pick<ToolService, 'call'>,
  version = '0.1.0',
): McpServer {
  const server = new McpServer(
    { name: 'kerf', version },
    {
      instructions: `${KERF_AGENT_SYSTEM_PROMPT}

MCP session rules:
- You are connected to a running Kerf desktop app over a loopback MCP endpoint.
- Edits are attributed to the mcp actor and remain undoable in the editor.
- If no project is open, read tools return a clean error. Ask the user to open a project in Kerf.
- Never move reference media onto the timeline, preview or export it.`,
    },
  );

  for (const definition of toolRegistry.list()) {
    server.registerTool(
      definition.name,
      {
        title: definition.name,
        description: definition.description,
        inputSchema: definition.input,
        annotations: {
          readOnlyHint: definition.readOnly,
          destructiveHint: !definition.readOnly,
          idempotentHint: definition.readOnly,
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        try {
          const value = await tools.call(definition.name, args, 'mcp');
          return textResult(value);
        } catch (cause) {
          return errorResult(`Kerf tool failed: ${errorMessage(cause)}`);
        }
      },
    );
  }

  return server;
}

/**
 * Loopback-only Streamable HTTP host. Each MCP session gets its own transport
 * and server so a client can disconnect without touching another client.
 */
export class McpServerHost {
  private readonly options: McpServerHostOptions;
  private readonly sessions = new Map<string, Session>();
  private httpServer: ReturnType<typeof createServer> | null = null;
  private listeningPort: number | null = null;

  constructor(options: McpServerHostOptions) {
    this.options = options;
  }

  get running(): boolean {
    return this.httpServer !== null;
  }

  get port(): number | null {
    return this.listeningPort;
  }

  get host(): string {
    return this.options.host ?? '127.0.0.1';
  }

  get endpoint(): string | null {
    return this.listeningPort === null
      ? null
      : `http://${this.host}:${this.listeningPort}${MCP_PATH}`;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  async start(port = this.options.port ?? DEFAULT_PORT): Promise<void> {
    if (this.httpServer) {
      return;
    }
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (cause: Error) => {
        server.off('listening', onListening);
        reject(cause);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, this.host);
    });
    this.httpServer = server;
    const address = server.address();
    this.listeningPort =
      address && typeof address === 'object'
        ? (address as AddressInfo).port
        : port;
  }

  async stop(): Promise<void> {
    const server = this.httpServer;
    if (!server) {
      return;
    }
    this.httpServer = null;
    this.listeningPort = null;
    for (const session of this.sessions.values()) {
      await session.transport.close().catch(() => undefined);
      await session.server.close().catch(() => undefined);
    }
    this.sessions.clear();
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const url = new URL(
        request.url ?? '/',
        `http://${request.headers.host ?? this.host}`,
      );
      if (url.pathname !== MCP_PATH) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('Not found');
        return;
      }

      const sessionId = request.headers['mcp-session-id'];
      const key = Array.isArray(sessionId) ? sessionId[0] : sessionId;
      let session = key ? this.sessions.get(key) : undefined;

      if (!session && request.method === 'POST' && !key) {
        session = await this.createSession();
      }
      if (!session) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('Unknown MCP session');
        return;
      }

      await session.transport.handleRequest(request, response);
    } catch (cause) {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain' });
      }
      response.end(errorMessage(cause));
    }
  }

  private async createSession(): Promise<Session> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, session);
      },
      onsessionclosed: (sessionId) => {
        this.sessions.delete(sessionId);
      },
    });
    const server = createKerfMcpServer(
      this.options.tools,
      this.options.version ?? '0.1.0',
    );
    // The callback above closes over this binding; it is assigned before the
    // client's initialize request is handled.
    const session: Session = { server, transport };
    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) {
        this.sessions.delete(sessionId);
      }
    };
    await server.connect(transport);
    return session;
  }
}
