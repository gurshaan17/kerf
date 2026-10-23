import { randomBytes } from 'node:crypto';
import type { SqliteDatabase } from '../db';
import type { SecretStore } from '../analysis/providers';
import type { McpSettings, McpSettingsUpdate } from '../../shared/contracts';

const KEYS = {
  enabled: 'mcp.enabled',
  autoStart: 'mcp.autoStart',
  port: 'mcp.port',
  token: 'mcp.token',
} as const;

const DEFAULT_PORT = 3919;

export interface McpSettingsStoreOptions {
  readonly database: SqliteDatabase;
  readonly secrets: SecretStore;
  readonly now?: () => number;
}

function newToken(): string {
  return `kerf_${randomBytes(24).toString('base64url')}`;
}

/**
 * MCP settings live beside the other app settings. The bearer token is
 * encrypted with the OS credential store before it touches SQLite, so a copied
 * database does not hand someone control of the editor.
 */
export class McpSettingsStore {
  private readonly database: SqliteDatabase;
  private readonly secrets: SecretStore;
  private readonly now: () => number;

  constructor(options: McpSettingsStoreOptions) {
    this.database = options.database;
    this.secrets = options.secrets;
    this.now = options.now ?? Date.now;
  }

  load(): McpSettings {
    return {
      enabled: this.read<boolean>(KEYS.enabled, false) === true,
      autoStart: this.read<boolean>(KEYS.autoStart, true) === true,
      port: this.normalizePort(this.read<number>(KEYS.port, DEFAULT_PORT)),
    };
  }

  update(update: McpSettingsUpdate): McpSettings {
    if (update.enabled !== undefined) {
      this.write(KEYS.enabled, update.enabled === true);
    }
    if (update.autoStart !== undefined) {
      this.write(KEYS.autoStart, update.autoStart === true);
    }
    if (update.port !== undefined) {
      if (
        !Number.isInteger(update.port) ||
        update.port < 0 ||
        update.port > 65_535
      ) {
        throw new Error('The MCP port must be an integer between 0 and 65535.');
      }
      this.write(KEYS.port, update.port);
    }
    return this.load();
  }

  token(): string {
    const stored = this.read<string | null>(KEYS.token, null);
    if (stored) {
      try {
        return this.secrets.decrypt(Buffer.from(stored, 'base64'));
      } catch {
        // A changed OS keychain or a copied database must not brick the
        // server. Issue a fresh token instead of reusing an unreadable one.
      }
    }
    return this.rotateToken();
  }

  rotateToken(): string {
    const token = newToken();
    this.write(
      KEYS.token,
      Buffer.from(this.secrets.encrypt(token)).toString('base64'),
    );
    return token;
  }

  private normalizePort(value: unknown): number {
    if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 65_535
    ) {
      return value;
    }
    return DEFAULT_PORT;
  }

  private read<T>(key: string, fallback: T): T {
    const row = this.database
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get(key) as { value_json: string } | undefined;
    if (!row) {
      return fallback;
    }
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return fallback;
    }
  }

  private write(key: string, value: unknown): void {
    this.database
      .prepare(
        `INSERT INTO app_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), this.now());
  }
}
