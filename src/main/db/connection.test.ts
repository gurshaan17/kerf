import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseLogger } from './connection';
import { migrateDatabase, openDatabase, probeFts5 } from './connection';
import type { Migration } from './migrations';
import { DATABASE_MIGRATIONS } from './migrations';

const LATEST_DATABASE_VERSION = DATABASE_MIGRATIONS.at(-1)?.version ?? 0;

interface LogRecord {
  message: string;
  detail?: Readonly<Record<string, unknown>>;
}

function captureLogger(): {
  logger: DatabaseLogger;
  info: LogRecord[];
  warnings: LogRecord[];
} {
  const info: LogRecord[] = [];
  const warnings: LogRecord[] = [];
  return {
    logger: {
      info(message, detail) {
        info.push({ message, detail });
      },
      warn(message, detail) {
        warnings.push({ message, detail });
      },
    },
    info,
    warnings,
  };
}

const tempDirectories: string[] = [];

function tempDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kerf-db-'));
  tempDirectories.push(directory);
  return join(directory, 'kerf.db');
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function insertProject(connection: Database.Database, id = 'project-1'): void {
  connection
    .prepare(
      `INSERT INTO projects (
        id, name, folder_path, width, height,
        frame_rate_num, frame_rate_den, doc_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, 'Test project', `/tmp/${id}`, 1920, 1080, 24, 1, '{}', 1, 1);
}

function tableNames(connection: Database.Database): Set<string> {
  const rows = connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

describe('openDatabase', () => {
  it('backfills only speech-linked audio from version 7 and remains stable on reopen', () => {
    const filename = tempDatabasePath();
    const old = openDatabase({
      filename,
      migrations: DATABASE_MIGRATIONS.filter(
        (migration) => migration.version <= 7,
      ),
      logger: captureLogger().logger,
    });
    try {
      insertProject(old.connection);
      const insertAsset = old.connection.prepare(
        `INSERT INTO assets (id, project_id, kind, name, path, metadata_json, payload_json, created_at) VALUES (?, 'project-1', ?, ?, ?, '{}', ?, 1)`,
      );
      for (const [id, kind] of [
        ['tts-audio', 'audio'],
        ['imported-audio', 'audio'],
        ['linked-video', 'video'],
        ['imported-video', 'video'],
      ] as const) {
        insertAsset.run(
          id,
          kind,
          id,
          `/tmp/${id}`,
          JSON.stringify({ id, kind, name: id, preserved: 'original' }),
        );
      }
      old.connection
        .prepare(
          `INSERT INTO transcripts (id, asset_id, language, text, words_json, payload_json, created_at) VALUES ('transcript-1', 'imported-video', 'en', 'Hello', '[]', '{}', 1)`,
        )
        .run();
      const insertTake = old.connection.prepare(
        `INSERT INTO tts_takes (id, project_id, transcript_id, segment_id, payload_json) VALUES (?, 'project-1', 'transcript-1', 'segment-1', ?)`,
      );
      insertTake.run('take-1', JSON.stringify({ assetId: 'tts-audio' }));
      // Even a legacy malformed linkage must not hide video from the Footage bin.
      insertTake.run('take-2', JSON.stringify({ assetId: 'linked-video' }));
      expect(old.connection.pragma('user_version', { simple: true })).toBe(7);
    } finally {
      old.close();
    }

    const payloads = (connection: Database.Database) =>
      connection
        .prepare('SELECT id, payload_json FROM assets ORDER BY id')
        .all() as Array<{ id: string; payload_json: string }>;
    const migrated = openDatabase({ filename, logger: captureLogger().logger });
    let afterMigration: Array<{ id: string; payload_json: string }>;
    try {
      afterMigration = payloads(migrated.connection);
      for (const row of afterMigration) {
        const payload = JSON.parse(row.payload_json);
        expect(payload.generatedBy).toBe(
          row.id === 'tts-audio' ? 'tts' : undefined,
        );
        expect(payload.preserved).toBe('original');
        expect(payload.name).toBe(row.id);
      }
      expect(migrated.connection.pragma('user_version', { simple: true })).toBe(
        LATEST_DATABASE_VERSION,
      );
    } finally {
      migrated.close();
    }
    const logs = captureLogger();
    const reopened = openDatabase({ filename, logger: logs.logger });
    try {
      expect(payloads(reopened.connection)).toEqual(afterMigration!);
      expect(
        logs.info.some((entry) => entry.message.includes('database migration')),
      ).toBe(false);
    } finally {
      reopened.close();
    }
  });

  it('migrates a fresh database and configures SQLite', () => {
    const { logger, info } = captureLogger();
    const handle = openDatabase({
      filename: tempDatabasePath(),
      logger,
    });

    try {
      expect(handle.connection.pragma('user_version', { simple: true })).toBe(
        LATEST_DATABASE_VERSION,
      );
      expect(handle.connection.pragma('journal_mode', { simple: true })).toBe(
        'wal',
      );
      expect(handle.connection.pragma('foreign_keys', { simple: true })).toBe(
        1,
      );
      expect(handle.connection.pragma('busy_timeout', { simple: true })).toBe(
        5_000,
      );
      expect(handle.fts5Enabled).toBe(true);

      const names = tableNames(handle.connection);
      for (const table of [
        'projects',
        'assets',
        'transcripts',
        'scenes',
        'beat_maps',
        'edit_log',
        'jobs',
        'exports',
        'reference_profiles',
        'compositions',
        'provider_accounts',
        'app_settings',
        'embedding_vectors',
        'transcript_fts',
        'scene_fts',
      ]) {
        expect(names.has(table)).toBe(true);
      }
      expect(names.has('kerf_fts5_probe')).toBe(false);
      expect(
        info.some((entry) => entry.message.includes('database migration')),
      ).toBe(true);
      expect(info.some((entry) => entry.message.includes('FTS5'))).toBe(true);
    } finally {
      handle.close();
    }
  });

  it('reopens without reapplying migrations and keeps snapshots', () => {
    const filename = tempDatabasePath();
    const first = openDatabase({ filename, logger: captureLogger().logger });
    insertProject(first.connection);
    first.close();

    const secondLogs = captureLogger();
    const second = openDatabase({ filename, logger: secondLogs.logger });
    try {
      expect(second.connection.pragma('user_version', { simple: true })).toBe(
        LATEST_DATABASE_VERSION,
      );
      const row = second.connection
        .prepare('SELECT count(*) AS count FROM projects')
        .get() as { count: number };
      expect(row.count).toBe(1);
      expect(
        secondLogs.info.some((entry) =>
          entry.message.includes('database migration'),
        ),
      ).toBe(false);
    } finally {
      second.close();
    }
  });

  it('enables foreign key cascades', () => {
    const handle = openDatabase({
      filename: tempDatabasePath(),
      logger: captureLogger().logger,
    });
    try {
      insertProject(handle.connection);
      handle.connection
        .prepare(
          `INSERT INTO assets (
            id, project_id, kind, name, path, metadata_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('asset-1', 'project-1', 'video', 'clip.mp4', 'clip.mp4', '{}', 1);

      handle.connection
        .prepare('DELETE FROM projects WHERE id = ?')
        .run('project-1');
      const row = handle.connection
        .prepare('SELECT count(*) AS count FROM assets')
        .get() as { count: number };
      expect(row.count).toBe(0);
    } finally {
      handle.close();
    }
  });

  it('accepts a custom busy timeout and rejects invalid options', () => {
    const handle = openDatabase({
      filename: tempDatabasePath(),
      busyTimeoutMs: 1_234,
      logger: captureLogger().logger,
    });
    try {
      expect(handle.connection.pragma('busy_timeout', { simple: true })).toBe(
        1_234,
      );
    } finally {
      handle.close();
    }

    expect(() => openDatabase({ filename: '   ' })).toThrow(
      /filename is required/i,
    );
    expect(() =>
      openDatabase({
        filename: tempDatabasePath(),
        busyTimeoutMs: -1,
      }),
    ).toThrow(/busy timeout/i);
  });
});

describe('migrateDatabase', () => {
  it('rolls back a failed migration and leaves the prior version', () => {
    const filename = tempDatabasePath();
    const migrations: Migration[] = [
      {
        version: 1,
        name: 'base',
        up(connection) {
          connection.exec(
            'CREATE TABLE one (id INTEGER PRIMARY KEY, value TEXT)',
          );
        },
      },
      {
        version: 2,
        name: 'broken',
        up(connection) {
          connection.exec(
            'CREATE TABLE two (id INTEGER PRIMARY KEY, value TEXT)',
          );
          throw new Error('intentional migration failure');
        },
      },
    ];

    expect(() =>
      openDatabase({
        filename,
        migrations,
        logger: captureLogger().logger,
      }),
    ).toThrow(/migration 2/i);

    const raw = new Database(filename);
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(1);
      const names = tableNames(raw);
      expect(names.has('one')).toBe(true);
      expect(names.has('two')).toBe(false);
    } finally {
      raw.close();
    }
  });

  it('rejects out-of-order migrations and newer databases', () => {
    const raw = new Database(':memory:');
    try {
      expect(() =>
        migrateDatabase(raw, [
          {
            version: 2,
            name: 'two',
            up() {},
          },
          {
            version: 1,
            name: 'one',
            up() {},
          },
        ]),
      ).toThrow(/strictly increasing/i);

      raw.pragma('user_version = 9');
      expect(() =>
        migrateDatabase(raw, [
          {
            version: 1,
            name: 'one',
            up() {},
          },
        ]),
      ).toThrow(/newer than this build/i);
    } finally {
      raw.close();
    }
  });
});

describe('probeFts5', () => {
  it('reports availability and leaves no probe table behind', () => {
    const raw = new Database(':memory:');
    const logs = captureLogger();
    try {
      expect(probeFts5(raw, logs.logger)).toBe(true);
      expect(logs.info.some((entry) => entry.message.includes('FTS5'))).toBe(
        true,
      );
      expect(tableNames(raw).has('kerf_fts5_probe')).toBe(false);
    } finally {
      raw.close();
    }
  });
});
