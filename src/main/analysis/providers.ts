import { randomUUID } from 'node:crypto';
import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import { createLanguageModel } from '@kerf/agent';
import type { SqliteDatabase } from '../db';
import type {
  ProviderAccount,
  ProviderKind,
  ProviderSaveRequest,
  ProviderTestResult,
} from '../../shared/contracts';

interface ProviderRow {
  id: string;
  kind: string;
  label: string;
  base_url: string | null;
  model: string | null;
  key_ciphertext: Buffer | null;
  enabled: number;
  vision_consent: number;
  chat_consent: number;
  created_at: number;
  updated_at: number;
}

export interface SecretStore {
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export interface ProviderStoreOptions {
  readonly database: SqliteDatabase;
  readonly secrets: SecretStore;
  readonly now?: () => number;
}

const DEFAULT_BASE_URL: Partial<Record<ProviderKind, string>> = {
  ollama: 'http://127.0.0.1:11434/v1',
  'openai-compatible': 'http://127.0.0.1:11434/v1',
};

const DEFAULT_MODEL: Partial<Record<ProviderKind, string>> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  google: 'gemini-2.0-flash',
  xai: 'grok-2-vision-1212',
  ollama: 'llava',
  'openai-compatible': 'llava',
};

function providerKind(value: string): ProviderKind {
  switch (value) {
    case 'openai':
    case 'anthropic':
    case 'google':
    case 'xai':
    case 'ollama':
    case 'openai-compatible':
      return value;
    default:
      return 'openai-compatible';
  }
}

function accountFromRow(row: ProviderRow): ProviderAccount {
  return {
    id: row.id,
    kind: providerKind(row.kind),
    label: row.label,
    baseUrl: row.base_url,
    model: row.model,
    hasKey: row.key_ciphertext !== null && row.key_ciphertext.length > 0,
    enabled: row.enabled !== 0,
    visionConsent: row.vision_consent !== 0,
    chatConsent: row.chat_consent !== 0,
  };
}

function providerModel(
  account: ProviderAccount,
  apiKey: string | null,
): LanguageModel {
  return createLanguageModel({
    kind: account.kind,
    label: account.label,
    baseUrl: account.baseUrl,
    model: account.model,
    apiKey,
  });
}

export class ProviderStore {
  private readonly database: SqliteDatabase;
  private readonly secrets: SecretStore;
  private readonly now: () => number;

  constructor(options: ProviderStoreOptions) {
    this.database = options.database;
    this.secrets = options.secrets;
    this.now = options.now ?? Date.now;
  }

  list(): ProviderAccount[] {
    const rows = this.database
      .prepare('SELECT * FROM provider_accounts ORDER BY created_at ASC')
      .all() as ProviderRow[];
    return rows.map(accountFromRow);
  }

  find(id: string): ProviderAccount | null {
    const row = this.database
      .prepare('SELECT * FROM provider_accounts WHERE id = ?')
      .get(id) as ProviderRow | undefined;
    return row ? accountFromRow(row) : null;
  }

  save(request: ProviderSaveRequest): ProviderAccount {
    const existing = request.id ? this.find(request.id) : null;
    const id = request.id ?? `provider_${randomUUID()}`;
    const currentKey = request.id
      ? (this.database
          .prepare('SELECT key_ciphertext FROM provider_accounts WHERE id = ?')
          .get(request.id) as { key_ciphertext: Buffer | null } | undefined)
      : undefined;
    let keyCiphertext = currentKey?.key_ciphertext ?? null;
    if (request.clearKey) {
      keyCiphertext = null;
    } else if (request.apiKey && request.apiKey.trim().length > 0) {
      keyCiphertext = this.secrets.encrypt(request.apiKey.trim());
    }
    const now = this.now();
    const values = {
      id,
      kind: request.kind,
      label: request.label.trim(),
      base_url:
        request.baseUrl?.trim() ||
        existing?.baseUrl ||
        DEFAULT_BASE_URL[request.kind] ||
        null,
      model:
        request.model?.trim() ||
        existing?.model ||
        DEFAULT_MODEL[request.kind] ||
        null,
      key_ciphertext: keyCiphertext,
      enabled: request.enabled === false ? 0 : 1,
      vision_consent: request.visionConsent === true ? 1 : 0,
      chat_consent:
        request.chatConsent === undefined
          ? existing?.chatConsent
            ? 1
            : 0
          : request.chatConsent
            ? 1
            : 0,
      created_at: now,
      updated_at: now,
    };
    this.database
      .prepare(
        `INSERT INTO provider_accounts (
          id, kind, label, base_url, model, key_ciphertext, enabled,
          vision_consent, chat_consent, created_at, updated_at
        ) VALUES (
          @id, @kind, @label, @base_url, @model, @key_ciphertext, @enabled,
          @vision_consent, @chat_consent, @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          label = excluded.label,
          base_url = excluded.base_url,
          model = excluded.model,
          key_ciphertext = excluded.key_ciphertext,
          enabled = excluded.enabled,
          vision_consent = excluded.vision_consent,
          chat_consent = excluded.chat_consent,
          updated_at = excluded.updated_at`,
      )
      .run(values);
    const saved = this.find(id);
    if (!saved) {
      throw new Error('The provider account could not be saved.');
    }
    return saved;
  }

  delete(id: string): boolean {
    return (
      this.database
        .prepare('DELETE FROM provider_accounts WHERE id = ?')
        .run(id).changes > 0
    );
  }

  apiKey(id: string): string | null {
    const row = this.database
      .prepare('SELECT key_ciphertext FROM provider_accounts WHERE id = ?')
      .get(id) as { key_ciphertext: Buffer | null } | undefined;
    if (!row?.key_ciphertext || row.key_ciphertext.length === 0) {
      return null;
    }
    return this.secrets.decrypt(row.key_ciphertext);
  }

  visionProvider(): ProviderAccount | null {
    return (
      this.list().find((account) => account.enabled && account.visionConsent) ??
      null
    );
  }

  chatProvider(): ProviderAccount | null {
    return (
      this.list().find((account) => account.enabled && account.chatConsent) ??
      null
    );
  }

  model(account: ProviderAccount): LanguageModel {
    return providerModel(account, this.apiKey(account.id));
  }

  async test(id: string): Promise<ProviderTestResult> {
    const account = this.find(id);
    if (!account) {
      return { ok: false, message: 'Provider not found.' };
    }
    if (
      account.kind !== 'ollama' &&
      account.kind !== 'openai-compatible' &&
      !account.hasKey
    ) {
      return { ok: false, message: 'Add an API key first.' };
    }
    try {
      const result = await generateText({
        model: this.model(account),
        prompt: 'Reply with the single word OK.',
        maxOutputTokens: 8,
      });
      return {
        ok: true,
        message: result.text.trim() || 'Connected.',
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Connection failed.',
      };
    }
  }
}
