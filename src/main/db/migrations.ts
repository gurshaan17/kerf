import type Database from 'better-sqlite3';

export interface Migration {
  readonly version: number;
  readonly name: string;
  up(connection: Database.Database): void;
}

const INITIAL_SCHEMA = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder_path TEXT NOT NULL UNIQUE,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  frame_rate_num INTEGER NOT NULL CHECK (frame_rate_num > 0),
  frame_rate_den INTEGER NOT NULL CHECK (frame_rate_den > 0),
  doc_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  duration_frames INTEGER,
  width INTEGER,
  height INTEGER,
  frame_rate_num INTEGER,
  frame_rate_den INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX assets_project_id_idx ON assets(project_id);

CREATE TABLE transcripts (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  language TEXT,
  text TEXT NOT NULL DEFAULT '',
  words_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX transcripts_asset_id_idx ON transcripts(asset_id);

CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  start_frame INTEGER NOT NULL CHECK (start_frame >= 0),
  end_frame INTEGER NOT NULL CHECK (end_frame > start_frame),
  description TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX scenes_asset_id_idx ON scenes(asset_id);

CREATE TABLE beat_maps (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  bpm REAL NOT NULL CHECK (bpm > 0),
  offset_frames INTEGER NOT NULL DEFAULT 0,
  beats_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX beat_maps_asset_id_idx ON beat_maps(asset_id);

CREATE TABLE edit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  command_json TEXT NOT NULL,
  inverse_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX edit_log_project_seq_idx ON edit_log(project_id, seq);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX jobs_project_id_idx ON jobs(project_id);

CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  preset TEXT NOT NULL DEFAULT '',
  output_path TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX exports_project_id_idx ON exports(project_id);

CREATE TABLE reference_profiles (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX reference_profiles_project_id_idx ON reference_profiles(project_id);
`;

/**
 * The child tables keep indexed columns for querying and a full model payload
 * for lossless round-trips. Payloads make schema evolution additive instead of
 * forcing a column for every nested field.
 */
const BUNDLE_PAYLOAD_COLUMNS = `
ALTER TABLE assets ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE transcripts ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE scenes ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE beat_maps ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
`;

const JOB_QUEUE_COLUMNS = `
ALTER TABLE jobs ADD COLUMN stage TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN result_json TEXT;
ALTER TABLE jobs ADD COLUMN started_at INTEGER;
ALTER TABLE jobs ADD COLUMN finished_at INTEGER;
ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
CREATE INDEX jobs_status_created_idx ON jobs(status, created_at);
`;

export const DATABASE_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up(connection) {
      connection.exec(INITIAL_SCHEMA);
    },
  },
  {
    version: 2,
    name: 'bundle payloads',
    up(connection) {
      connection.exec(BUNDLE_PAYLOAD_COLUMNS);
    },
  },
  {
    version: 3,
    name: 'persistent job queue',
    up(connection) {
      connection.exec(JOB_QUEUE_COLUMNS);
    },
  },
];
