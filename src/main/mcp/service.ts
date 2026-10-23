import type { SqliteDatabase } from '../db';
import type { SecretStore } from '../analysis/providers';
import type {
  McpSettings,
  McpSettingsUpdate,
  McpStatus,
} from '../../shared/contracts';
import type { ToolService } from '../tools/service';
import { McpServerHost } from './server';
import { McpSettingsStore } from './settings';

export interface McpServiceOptions {
  readonly database: SqliteDatabase;
  readonly secrets: SecretStore;
  readonly tools: Pick<ToolService, 'call'>;
  readonly version?: string;
  readonly now?: () => number;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Owns the MCP lifecycle. Settings decide whether the loopback listener starts,
 * and a failed bind is reported as status instead of crashing the editor.
 */
export class McpService {
  private readonly store: McpSettingsStore;
  private readonly options: McpServiceOptions;
  private host: McpServerHost | null = null;
  private lastError: string | null = null;

  constructor(options: McpServiceOptions) {
    this.options = options;
    this.store = new McpSettingsStore({
      database: options.database,
      secrets: options.secrets,
      now: options.now,
    });
  }

  settings(): McpSettings {
    return this.store.load();
  }

  async status(): Promise<McpStatus> {
    const settings = this.store.load();
    let token = '';
    try {
      token = this.store.token();
    } catch (cause) {
      this.lastError = errorMessage(cause);
    }
    const host = this.host;
    return {
      ...settings,
      port: host?.port ?? settings.port,
      running: host?.running ?? false,
      endpoint: host?.endpoint ?? null,
      token,
      sessions: host?.sessionCount ?? 0,
      activity: host?.recentActivity() ?? [],
      error: this.lastError,
    };
  }

  async update(update: McpSettingsUpdate): Promise<McpStatus> {
    const previous = this.store.load();
    let next: McpSettings;
    try {
      next = this.store.update(update);
    } catch (cause) {
      this.lastError = errorMessage(cause);
      return this.status();
    }

    if (!next.enabled) {
      await this.stop();
      return this.status();
    }

    if (this.host?.running && previous.port !== next.port) {
      await this.stop();
    }
    await this.start();
    return this.status();
  }

  async startIfEnabled(): Promise<McpStatus> {
    const settings = this.store.load();
    if (settings.enabled && settings.autoStart) {
      await this.start();
    }
    return this.status();
  }

  async start(): Promise<McpStatus> {
    const settings = this.store.load();
    if (!settings.enabled) {
      return this.status();
    }
    if (this.host?.running) {
      return this.status();
    }
    try {
      const token = this.store.token();
      if (!this.host) {
        this.host = new McpServerHost({
          tools: this.options.tools,
          token,
          port: settings.port,
          version: this.options.version,
        });
      }
      await this.host.start(settings.port);
      this.lastError = null;
    } catch (cause) {
      this.lastError = errorMessage(cause);
    }
    return this.status();
  }

  async stop(): Promise<void> {
    await this.host?.stop();
  }

  async rotateToken(): Promise<McpStatus> {
    try {
      const token = this.store.rotateToken();
      if (this.host) {
        this.host.setToken(token);
        await this.host.revokeSessions();
      }
      this.lastError = null;
    } catch (cause) {
      this.lastError = errorMessage(cause);
    }
    return this.status();
  }

  dispose(): void {
    void this.stop();
  }
}
