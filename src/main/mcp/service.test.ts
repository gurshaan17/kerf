import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db';
import type { DatabaseHandle } from '../db';
import { McpService } from './service';

const contexts: Array<{ database: DatabaseHandle; root: string }> = [];

function makeService() {
  const root = mkdtempSync(join(tmpdir(), 'kerf-mcp-'));
  const database = openDatabase({ filename: join(root, 'kerf.db') });
  contexts.push({ database, root });
  return {
    root,
    database,
    service: new McpService({
      database: database.connection,
      secrets: {
        encrypt: (value) => Buffer.from(`cipher:${value}`, 'utf8'),
        decrypt: (value) => value.toString('utf8').replace(/^cipher:/, ''),
      },
      tools: { call: async () => ({ ok: true }) },
      now: () => 5_000,
    }),
  };
}

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    context.database.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

describe('McpService', () => {
  it('keeps the token stable and starts only when enabled', async () => {
    const { service } = makeService();
    const initial = await service.status();
    expect(initial).toMatchObject({
      enabled: false,
      running: false,
      endpoint: null,
      sessions: 0,
    });
    expect(initial.token).toMatch(/^kerf_/);

    const disabled = await service.startIfEnabled();
    expect(disabled.running).toBe(false);

    const started = await service.update({ enabled: true, port: 0 });
    expect(started).toMatchObject({
      enabled: true,
      running: true,
      sessions: 0,
      error: null,
    });
    expect(started.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(started.token).toBe(initial.token);
    await service.stop();
  });

  it('rotates the token, revokes sessions and preserves settings', async () => {
    const { service, root } = makeService();
    const started = await service.update({
      enabled: true,
      autoStart: true,
      port: 0,
    });
    const rotated = await service.rotateToken();
    expect(rotated.token).not.toBe(started.token);
    expect(rotated.sessions).toBe(0);

    await service.stop();
    const reopenedDatabase = openDatabase({
      filename: join(root, 'kerf.db'),
    });
    contexts.push({ database: reopenedDatabase, root });
    const reopened = new McpService({
      database: reopenedDatabase.connection,
      secrets: {
        encrypt: (value) => Buffer.from(`cipher:${value}`, 'utf8'),
        decrypt: (value) => value.toString('utf8').replace(/^cipher:/, ''),
      },
      tools: { call: async () => ({ ok: true }) },
    });
    const auto = await reopened.startIfEnabled();
    expect(auto).toMatchObject({
      enabled: true,
      autoStart: true,
      running: true,
      token: rotated.token,
    });
    await reopened.stop();
  });

  it('reports a bind failure without crashing the editor', async () => {
    const { service } = makeService();
    const started = await service.update({ enabled: true, port: 0 });
    const occupied = started.port;
    if (occupied === 0) {
      throw new Error('expected an ephemeral port');
    }
    const other = makeService().service;
    const blocked = await other.update({ enabled: true, port: occupied });
    expect(blocked.running).toBe(false);
    expect(blocked.error).toMatch(/EADDRINUSE|address already in use/i);
    await other.stop();
    await service.stop();
  });
});
