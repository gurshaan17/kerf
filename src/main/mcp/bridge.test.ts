import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServerHost } from './server';

const BRIDGE = fileURLToPath(
  new URL('../../../packages/mcp-bridge/src/index.mjs', import.meta.url),
);

const hosts: McpServerHost[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.stop();
  }
});

describe('stdio bridge', () => {
  it('proxies the Kerf catalog over stdio', async () => {
    const token = 'kerf_bridge_token';
    const call = vi.fn(async () => ({
      sequence: { durationFrames: 120 },
      tracks: [{ id: 'track_video' }],
    }));
    const host = new McpServerHost({
      token,
      tools: { call },
      port: 0,
    });
    hosts.push(host);
    await host.start();
    if (!host.endpoint) {
      throw new Error('host is not listening');
    }

    let stderr = '';
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BRIDGE, '--url', host.endpoint, '--token', token],
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const client = new Client({ name: 'kerf-bridge-test', version: '0.0.0' });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toContain('readTimeline');
      expect(client.getInstructions()).toMatch(/Kerf/);

      const result = await client.callTool({
        name: 'readTimeline',
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain('durationFrames');
      expect(call).toHaveBeenCalledWith(
        'readTimeline',
        { includeMarkers: true },
        'mcp',
      );
    } catch (cause) {
      throw new Error(
        `${cause instanceof Error ? cause.message : String(cause)}\n${stderr}`,
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  }, 30_000);
});
