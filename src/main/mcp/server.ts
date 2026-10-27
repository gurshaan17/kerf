import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { KERF_AGENT_SYSTEM_PROMPT } from '@kerf/agent';
import { toolRegistry } from '@kerf/tools';
import type { McpActivity, McpActivityKind } from '../../shared/contracts';
import type { ToolService } from '../tools/service';

export interface McpServerHostOptions {
  readonly tools: Pick<ToolService, 'call'>;
  readonly token: string;
  readonly host?: string;
  readonly port?: number;
  readonly version?: string;
}

const MAX_ACTIVITY = 20;

function tokenMatches(expected: string, provided: string): boolean {
  const left = createHash('sha256').update(expected).digest();
  const right = createHash('sha256').update(provided).digest();
  return timingSafeEqual(left, right);
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

function renderedFramePath(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('path' in value)) {
    return null;
  }
  const path = (value as { path?: unknown }).path;
  return typeof path === 'string' && path.length > 0 ? path : null;
}

/**
 * `renderFrame` carries a cache path so the image can be re-read on demand.
 * MCP clients get the PNG itself when the file is still present, followed by
 * the JSON text for clients that only render text.
 */
function textResult(value: unknown, toolName?: string) {
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  > = [];
  if (toolName === 'renderFrame') {
    const path = renderedFramePath(value);
    if (path) {
      try {
        const mimeType = (value as { mimeType?: unknown }).mimeType;
        content.push({
          type: 'image',
          data: readFileSync(path).toString('base64'),
          mimeType: typeof mimeType === 'string' ? mimeType : 'image/png',
        });
      } catch {
        // The path may have been pruned between the render and this call.
      }
    }
  }
  content.push({
    type: 'text',
    text: JSON.stringify(value, null, 2),
  });
  return { content };
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
  onTool?: (ok: boolean, message: string, tool: string) => void,
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
        const startedAt = Date.now();
        try {
          const value = await tools.call(definition.name, args, 'mcp');
          onTool?.(
            true,
            `Completed in ${Date.now() - startedAt}ms`,
            definition.name,
          );
          return textResult(value, definition.name);
        } catch (cause) {
          const message = errorMessage(cause);
          onTool?.(false, message.slice(0, 300), definition.name);
          return errorResult(`Kerf tool failed: ${message}`);
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
  private readonly activities: McpActivity[] = [];
  private httpServer: ReturnType<typeof createServer> | null = null;
  private listeningPort: number | null = null;
  private token: string;

  constructor(options: McpServerHostOptions) {
    this.options = options;
    this.token = options.token;
  }

  setToken(token: string): void {
    this.token = token;
    this.record('auth', true, 'Bearer token rotated');
  }

  async revokeSessions(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];
    for (const session of this.sessions.values()) {
      await session.transport.close().catch(() => undefined);
      await session.server.close().catch(() => undefined);
    }
    this.sessions.clear();
    if (sessionIds.length > 0) {
      this.record(
        'session',
        true,
        `Revoked ${sessionIds.length} active ${sessionIds.length === 1 ? 'session' : 'sessions'}`,
      );
    }
  }

  recentActivity(): readonly McpActivity[] {
    return [...this.activities];
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
    this.record('server', true, `Listening on ${this.endpoint}`);
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
    this.record('server', true, 'Server stopped');
  }

  private record(
    kind: McpActivityKind,
    ok: boolean,
    message: string,
    tool?: string,
  ): void {
    this.activities.unshift({
      id: `mcp_activity_${randomUUID()}`,
      at: Date.now(),
      kind,
      ok,
      message,
      ...(tool ? { tool } : {}),
    });
    if (this.activities.length > MAX_ACTIVITY) {
      this.activities.length = MAX_ACTIVITY;
    }
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

      const rejected = this.accessError(request);
      if (rejected) {
        this.record('auth', false, rejected.message);
        response.writeHead(rejected.status, {
          'content-type': 'text/plain',
          ...(rejected.status === 401
            ? { 'www-authenticate': 'Bearer realm="kerf"' }
            : {}),
        });
        response.end(rejected.message);
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

  private accessError(
    request: IncomingMessage,
  ): { readonly status: number; readonly message: string } | null {
    const port = this.listeningPort;
    const host = request.headers.host?.toLowerCase();
    const allowedHosts = new Set([
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
    ]);
    if (!host || !allowedHosts.has(host)) {
      return { status: 403, message: 'Host is not allowed.' };
    }

    const origin = request.headers.origin;
    if (origin && origin !== 'null') {
      const allowedOrigins = new Set([
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
      ]);
      if (!allowedOrigins.has(origin)) {
        return { status: 403, message: 'Origin is not allowed.' };
      }
    }

    const authorization = request.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    const provided = match?.[1]?.trim() ?? '';
    if (!provided || !tokenMatches(this.token, provided)) {
      return { status: 401, message: 'A valid Kerf bearer token is required.' };
    }
    return null;
  }

  private async createSession(): Promise<Session> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, session);
        this.record('session', true, 'Client session opened');
      },
      onsessionclosed: (sessionId) => {
        this.sessions.delete(sessionId);
      },
    });
    const server = createKerfMcpServer(
      this.options.tools,
      this.options.version ?? '0.1.0',
      (ok, message, tool) => this.record('tool', ok, message, tool),
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
