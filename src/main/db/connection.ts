import Database from 'better-sqlite3';
import type { Migration } from './migrations';
import { DATABASE_MIGRATIONS } from './migrations';

export type SqliteDatabase = Database.Database;

export interface DatabaseLogger {
  info(message: string, detail?: Readonly<Record<string, unknown>>): void;
  warn?(message: string, detail?: Readonly<Record<string, unknown>>): void;
}

export const consoleDatabaseLogger: DatabaseLogger = {
  info(message, detail) {
    if (detail) {
      console.info(`[db] ${message}`, detail);
    } else {
      console.info(`[db] ${message}`);
    }
  },
  warn(message, detail) {
    if (detail) {
      console.warn(`[db] ${message}`, detail);
    } else {
      console.warn(`[db] ${message}`);
    }
  },
};

export interface OpenDatabaseOptions {
  filename: string;
  migrations?: readonly Migration[];
  logger?: DatabaseLogger;
  busyTimeoutMs?: number;
}

export interface DatabaseHandle {
  readonly connection: SqliteDatabase;
  readonly fts5Enabled: boolean;
  close(): void;
}

function validateMigrations(migrations: readonly Migration[]): void {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error('Migration versions must be positive integers.');
    }
    if (migration.version <= previous) {
      throw new Error('Migration versions must be strictly increasing.');
    }
    if (migration.name.trim().length === 0) {
      throw new Error(`Migration ${migration.version} needs a name.`);
    }
    previous = migration.version;
  }
}

/**
 * Apply every migration newer than `PRAGMA user_version`. Each migration and
 * its version bump run in one transaction, so a failed step leaves the database
 * on the previous version.
 */
export function migrateDatabase(
  connection: SqliteDatabase,
  migrations: readonly Migration[] = DATABASE_MIGRATIONS,
  logger: DatabaseLogger = consoleDatabaseLogger,
): number[] {
  validateMigrations(migrations);
  const rawVersion = connection.pragma('user_version', { simple: true });
  const currentVersion = Number(rawVersion ?? 0);
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error('The database user_version is not a non-negative integer.');
  }

  const latestVersion = migrations.at(-1)?.version ?? 0;
  if (currentVersion > latestVersion) {
    throw new Error(
      `Database version ${currentVersion} is newer than this build (${latestVersion}).`,
    );
  }

  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    const run = connection.transaction(() => {
      migration.up(connection);
      connection.pragma(`user_version = ${migration.version}`);
    });

    try {
      run();
    } catch (error) {
      throw new Error(
        `Database migration ${migration.version} (${migration.name}) failed.`,
        { cause: error },
      );
    }

    applied.push(migration.version);
    logger.info('Applied database migration', {
      version: migration.version,
      name: migration.name,
    });
  }
  return applied;
}

/**
 * Probe FTS5 with a real virtual table rather than a compile-option string, so
 * a build that exposes the flag but cannot create a table is still rejected.
 */
export function probeFts5(
  connection: SqliteDatabase,
  logger: DatabaseLogger = consoleDatabaseLogger,
): boolean {
  let created = false;
  try {
    connection.exec(
      'CREATE VIRTUAL TABLE temp.kerf_fts5_probe USING fts5(value)',
    );
    created = true;
    connection
      .prepare('INSERT INTO temp.kerf_fts5_probe(value) VALUES (?)')
      .run('kerf fts5 capability probe');
    const row = connection
      .prepare(
        "SELECT count(*) AS count FROM temp.kerf_fts5_probe WHERE kerf_fts5_probe MATCH 'kerf'",
      )
      .get() as { count?: number } | undefined;

    const enabled = (row?.count ?? 0) > 0;
    logger.info('Probed SQLite FTS5 capability', { enabled });
    return enabled;
  } catch (error) {
    const detail = {
      enabled: false,
      error: error instanceof Error ? error.message : String(error),
    };
    if (logger.warn) {
      logger.warn('SQLite FTS5 capability probe failed', detail);
    } else {
      logger.info('SQLite FTS5 capability probe failed', detail);
    }
    return false;
  } finally {
    if (created) {
      try {
        connection.exec('DROP TABLE temp.kerf_fts5_probe');
      } catch {
        // A failed probe may leave nothing to drop; the connection can continue.
      }
    }
  }
}

export function openDatabase(options: OpenDatabaseOptions): DatabaseHandle {
  if (options.filename.trim().length === 0) {
    throw new Error('A database filename is required.');
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new Error('The SQLite busy timeout must be a non-negative integer.');
  }

  const logger = options.logger ?? consoleDatabaseLogger;
  const connection = new Database(options.filename);
  try {
    connection.pragma('journal_mode = WAL');
    connection.pragma('foreign_keys = ON');
    connection.pragma(`busy_timeout = ${busyTimeoutMs}`);
    connection.pragma('synchronous = NORMAL');

    migrateDatabase(
      connection,
      options.migrations ?? DATABASE_MIGRATIONS,
      logger,
    );
    const fts5Enabled = probeFts5(connection, logger);

    let closed = false;
    return {
      connection,
      fts5Enabled,
      close() {
        if (closed) {
          return;
        }
        closed = true;
        if (connection.open) {
          connection.close();
        }
      },
    };
  } catch (error) {
    if (connection.open) {
      connection.close();
    }
    throw error;
  }
}
