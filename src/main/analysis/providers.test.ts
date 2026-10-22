import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db';
import type { DatabaseHandle } from '../db';
import { ProviderStore } from './providers';

const contexts: Array<{ database: DatabaseHandle; root: string }> = [];

function makeStore() {
  const root = mkdtempSync(join(tmpdir(), 'kerf-providers-'));
  const database = openDatabase({ filename: join(root, 'kerf.db') });
  contexts.push({ database, root });
  return {
    database,
    store: new ProviderStore({
      database: database.connection,
      now: () => 5_000,
      secrets: {
        encrypt: (value) => Buffer.from(`cipher:${value}`, 'utf8'),
        decrypt: (value) => value.toString('utf8').replace(/^cipher:/, ''),
      },
    }),
  };
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.database.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

describe('ProviderStore', () => {
  it('stores provider keys encrypted and never returns them in account data', () => {
    const { database, store } = makeStore();
    const saved = store.save({
      kind: 'openai',
      label: 'OpenAI',
      apiKey: 'sk-secret-value',
      visionConsent: true,
      enabled: true,
    });

    expect(saved.hasKey).toBe(true);
    expect(saved.visionConsent).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('sk-secret-value');
    expect(store.apiKey(saved.id)).toBe('sk-secret-value');

    const row = database.connection
      .prepare('SELECT key_ciphertext FROM provider_accounts WHERE id = ?')
      .get(saved.id) as { key_ciphertext: Buffer };
    expect(row.key_ciphertext.toString('utf8')).toBe('cipher:sk-secret-value');
    expect(store.visionProvider()?.id).toBe(saved.id);
  });

  it('preserves a key on update, then clears it explicitly', () => {
    const { store } = makeStore();
    const saved = store.save({
      kind: 'anthropic',
      label: 'Anthropic',
      apiKey: 'sk-ant',
    });

    const updated = store.save({
      id: saved.id,
      kind: 'anthropic',
      label: 'Anthropic Pro',
      model: 'custom-model',
    });
    expect(updated.hasKey).toBe(true);
    expect(updated.model).toBe('custom-model');
    expect(store.apiKey(saved.id)).toBe('sk-ant');

    const cleared = store.save({
      id: saved.id,
      kind: 'anthropic',
      label: 'Anthropic Pro',
      clearKey: true,
    });
    expect(cleared.hasKey).toBe(false);
    expect(store.apiKey(saved.id)).toBeNull();
  });

  it('requires consent before a provider is used for vision', () => {
    const { store } = makeStore();
    store.save({
      kind: 'openai',
      label: 'No consent',
      apiKey: 'key',
      visionConsent: false,
    });
    expect(store.visionProvider()).toBeNull();
  });

  it('reports a missing key instead of making a request', async () => {
    const { store } = makeStore();
    const saved = store.save({
      kind: 'openai',
      label: 'No key',
      visionConsent: true,
    });
    const result = await store.test(saved.id);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/API key/);
  });

  it('deletes provider accounts', () => {
    const { store } = makeStore();
    const saved = store.save({ kind: 'ollama', label: 'Local Ollama' });
    expect(store.list()).toHaveLength(1);
    expect(store.delete(saved.id)).toBe(true);
    expect(store.list()).toEqual([]);
  });
});
