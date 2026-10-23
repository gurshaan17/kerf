import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServerHost } from './server';

const hosts: McpServerHost[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.stop();
  }
});

async function connect(host: McpServerHost, token: string) {
  if (!host.endpoint) {
    throw new Error('host is not listening');
  }
  const client = new Client({ name: 'kerf-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(host.endpoint), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
  await client.connect(transport);
  return { client, transport };
}

describe('McpServerHost', () => {
  it('lists the shared Kerf catalog over loopback Streamable HTTP', async () => {
    const call = vi.fn(async (name: string) =>
      name === 'readTimeline'
        ? { sequence: { durationFrames: 48 }, tracks: [] }
        : { ok: true },
    );
    const token = 'kerf_test_token';
    const host = new McpServerHost({ tools: { call }, token, port: 0 });
    hosts.push(host);
    await host.start();

    expect(host.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const { client } = await connect(host, token);
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      expect(names).toContain('readTimeline');
      expect(names).toContain('insertText');
      expect(names).toContain('startExport');
      expect(client.getInstructions()).toMatch(/Kerf's editing agent/);
      expect(host.sessionCount).toBe(1);

      const called = await client.callTool({
        name: 'readTimeline',
        arguments: {},
      });
      expect(call).toHaveBeenCalledWith(
        'readTimeline',
        { includeMarkers: true },
        'mcp',
      );
      expect(called.isError).not.toBe(true);
      expect(JSON.stringify(called.content)).toContain('durationFrames');
      expect(
        host
          .recentActivity()
          .some(
            (activity) =>
              activity.kind === 'tool' &&
              activity.tool === 'readTimeline' &&
              activity.ok,
          ),
      ).toBe(true);
    } finally {
      await client.close();
    }
  }, 20_000);

  it('returns a tool error instead of dropping the session', async () => {
    const token = 'kerf_test_token';
    const host = new McpServerHost({
      token,
      tools: {
        call: async () => {
          throw new Error('Open a project before using tools.');
        },
      },
      port: 0,
    });
    hosts.push(host);
    await host.start();
    const { client } = await connect(host, token);
    try {
      const result = await client.callTool({
        name: 'readTimeline',
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toMatch(/Open a project/);
      expect(host.sessionCount).toBe(1);
    } finally {
      await client.close();
    }
  }, 20_000);

  it('rejects a wrong token and invalidates sessions on rotation', async () => {
    const token = 'kerf_original_token';
    const host = new McpServerHost({
      token,
      tools: { call: async () => ({ ok: true }) },
      port: 0,
    });
    hosts.push(host);
    await host.start();
    const endpoint = host.endpoint;
    if (!endpoint) {
      throw new Error('host is not listening');
    }

    const denied = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(denied.status).toBe(401);
    expect(host.recentActivity()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'auth', ok: false }),
      ]),
    );

    const { client } = await connect(host, token);
    await expect(client.listTools()).resolves.toBeTruthy();
    host.setToken('kerf_rotated_token');
    await host.revokeSessions();
    expect(host.sessionCount).toBe(0);

    const stale = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(stale.status).toBe(401);
    await client.close().catch(() => undefined);
  }, 20_000);

  it('keeps only the last twenty activity entries', async () => {
    const host = new McpServerHost({
      token: 'kerf_activity_token',
      tools: { call: async () => ({ ok: true }) },
      port: 0,
    });
    hosts.push(host);
    await host.start();
    const endpoint = host.endpoint;
    if (!endpoint) {
      throw new Error('host is not listening');
    }
    for (let index = 0; index < 25; index += 1) {
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: 'Bearer wrong-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: index,
          method: 'tools/list',
        }),
      });
    }
    expect(host.recentActivity()).toHaveLength(20);
    expect(host.recentActivity().every((entry) => !entry.ok)).toBe(true);
  }, 20_000);
});
