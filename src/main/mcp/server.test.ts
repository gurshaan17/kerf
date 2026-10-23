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

async function connect(host: McpServerHost) {
  if (!host.endpoint) {
    throw new Error('host is not listening');
  }
  const client = new Client({ name: 'kerf-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(host.endpoint));
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
    const host = new McpServerHost({ tools: { call }, port: 0 });
    hosts.push(host);
    await host.start();

    expect(host.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const { client } = await connect(host);
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
    } finally {
      await client.close();
    }
  }, 20_000);

  it('returns a tool error instead of dropping the session', async () => {
    const host = new McpServerHost({
      tools: {
        call: async () => {
          throw new Error('Open a project before using tools.');
        },
      },
      port: 0,
    });
    hosts.push(host);
    await host.start();
    const { client } = await connect(host);
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
});
