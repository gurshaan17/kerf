import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type {
  Asset,
  BeatMap,
  CreateProjectInput,
  EditCommand,
  Project,
  ReferenceProfile,
  Scene,
  Transcript,
} from '@kerf/model';
import {
  assetSchema,
  beatMapSchema,
  createProject,
  projectSchema,
  referenceProfileSchema,
  sceneSchema,
  transcriptSchema,
} from '@kerf/model';
import type { DatabaseLogger, SqliteDatabase } from '../db';
import type { ProjectBundle, ProjectSummary } from '../../shared/contracts';
import { ensureProjectFolders, isPathInside, projectFolderName } from './paths';

export interface ProjectRepositoryOptions {
  readonly database: SqliteDatabase;
  readonly projectsRoot: string;
  readonly now?: () => number;
  readonly logger?: DatabaseLogger;
}

export interface CreateStoredProjectInput extends Omit<
  CreateProjectInput,
  'now'
> {
  readonly now?: number;
}

export interface EditLogEntryInput {
  readonly id: string;
  readonly commandId: string;
  readonly actor: string;
  readonly label: string;
  readonly command: EditCommand;
  readonly inverse: EditCommand | null;
  readonly createdAt: number;
}

export interface EditLogRecord extends EditLogEntryInput {
  readonly sequence: number;
  readonly projectId: string;
}

interface ProjectRow {
  id: string;
  name: string;
  folder_path: string;
  width: number;
  height: number;
  frame_rate_num: number;
  frame_rate_den: number;
  doc_json: string;
  created_at: number;
  updated_at: number;
  asset_count?: number;
}

interface ChildRow {
  id: string;
  project_id?: string;
  asset_id?: string;
  kind?: string;
  name?: string;
  path?: string;
  language?: string | null;
  text?: string | null;
  words_json?: string | null;
  start_frame?: number | null;
  end_frame?: number | null;
  description?: string | null;
  confidence?: number | null;
  bpm?: number | null;
  offset_frames?: number | null;
  beats_json?: string | null;
  payload_json?: string | null;
  created_at: number;
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readPayload<Result>(
  row: ChildRow,
  schema: z.ZodType<Result>,
): Result | null {
  if (
    typeof row.payload_json !== 'string' ||
    row.payload_json.length === 0 ||
    row.payload_json === '{}'
  ) {
    return null;
  }
  try {
    return schema.parse(readJson(row.payload_json));
  } catch {
    return null;
  }
}

function projectFromRow(row: ProjectRow): Project {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.doc_json);
  } catch (error) {
    throw new Error(`Project ${row.id} has an unreadable snapshot.`, {
      cause: error,
    });
  }
  try {
    return projectSchema.parse(parsed);
  } catch (error) {
    throw new Error(`Project ${row.id} has an invalid snapshot.`, {
      cause: error,
    });
  }
}

function projectValues(
  project: Project,
  folderPath: string,
): {
  id: string;
  name: string;
  folder_path: string;
  width: number;
  height: number;
  frame_rate_num: number;
  frame_rate_den: number;
  doc_json: string;
  created_at: number;
  updated_at: number;
} {
  return {
    id: project.id,
    name: project.name,
    folder_path: folderPath,
    width: project.sequence.width,
    height: project.sequence.height,
    frame_rate_num: project.sequence.frameRate.numerator,
    frame_rate_den: project.sequence.frameRate.denominator,
    doc_json: JSON.stringify(project),
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
}

function projectSummaryFromRow(row: ProjectRow): ProjectSummary {
  const project = projectFromRow(row);
  return {
    id: project.id,
    name: project.name,
    folderPath: row.folder_path,
    width: project.sequence.width,
    height: project.sequence.height,
    frameRate: project.sequence.frameRate,
    durationFrames: project.sequence.durationFrames,
    assetCount: Number(row.asset_count ?? 0),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function fallbackAsset(row: ChildRow): Asset {
  return assetSchema.parse({
    id: row.id,
    projectId: row.project_id ?? '',
    name: row.name ?? 'Media',
    kind: row.kind ?? 'other',
    status: 'queued',
    sourcePath: row.path ?? '',
    fileSize: 0,
    mtimeMs: 0,
    contentHash: null,
    durationSeconds: 0,
    width: null,
    height: null,
    frameRate: null,
    hasVideo: row.kind === 'video',
    hasAudio: row.kind === 'video' || row.kind === 'audio',
    streams: [],
    cache: {
      proxyPath: null,
      thumbnailPath: null,
      waveformPath: null,
      filmstripPath: null,
    },
    transcriptId: null,
    error: null,
    importedAt: row.created_at,
    updatedAt: row.created_at,
  });
}

function assetFromRow(row: ChildRow): Asset {
  return readPayload(row, assetSchema) ?? fallbackAsset(row);
}

function transcriptFromRow(row: ChildRow): Transcript {
  return (
    readPayload(row, transcriptSchema) ??
    transcriptSchema.parse({
      id: row.id,
      assetId: row.asset_id ?? '',
      language: row.language ?? 'en',
      text: row.text ?? '',
      segments: [],
      model: null,
      createdAt: row.created_at,
    })
  );
}

function sceneFromRow(row: ChildRow): Scene {
  return (
    readPayload(row, sceneSchema) ??
    sceneSchema.parse({
      id: row.id,
      assetId: row.asset_id ?? '',
      index: 0,
      startFrame: row.start_frame ?? 0,
      endFrame:
        (row.end_frame ?? 1) > (row.start_frame ?? 0)
          ? row.end_frame
          : (row.start_frame ?? 0) + 1,
      thumbnailPath: null,
      score: row.confidence ?? 0.5,
    })
  );
}

function beatMapFromRow(row: ChildRow): BeatMap {
  return (
    readPayload(row, beatMapSchema) ??
    beatMapSchema.parse({
      id: row.id,
      assetId: row.asset_id ?? '',
      bpm: row.bpm ?? 120,
      offsetFrames: row.offset_frames ?? 0,
      beats: [],
      sections: [],
      createdAt: row.created_at,
    })
  );
}

function referenceProfileFromRow(row: ChildRow): ReferenceProfile {
  const payload = readPayload(row, referenceProfileSchema);
  if (payload) {
    return payload;
  }
  return referenceProfileSchema.parse({
    id: row.id,
    name: row.name ?? 'Reference',
    createdAt: row.created_at,
  });
}

function frameDuration(asset: Asset): number | null {
  if (!asset.frameRate) {
    return null;
  }
  return Math.round(
    (asset.durationSeconds * asset.frameRate.numerator) /
      asset.frameRate.denominator,
  );
}

export class ProjectRepository {
  private readonly database: SqliteDatabase;
  private readonly projectsRoot: string;
  private readonly now: () => number;
  private readonly logger?: DatabaseLogger;

  constructor(options: ProjectRepositoryOptions) {
    if (options.projectsRoot.trim().length === 0) {
      throw new Error('A projects root is required.');
    }
    this.database = options.database;
    this.projectsRoot = resolve(options.projectsRoot);
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
    mkdirSync(this.projectsRoot, { recursive: true });
  }

  get root(): string {
    return this.projectsRoot;
  }

  create(input: CreateStoredProjectInput): ProjectBundle {
    const project = createProject({
      ...input,
      now: input.now ?? this.now(),
    });
    const folderPath = join(
      this.projectsRoot,
      projectFolderName(project.name, project.id),
    );
    mkdirSync(folderPath, { recursive: true });
    ensureProjectFolders(folderPath);

    try {
      const values = projectValues(project, folderPath);
      this.database
        .prepare(
          `INSERT INTO projects (
            id, name, folder_path, width, height,
            frame_rate_num, frame_rate_den, doc_json, created_at, updated_at
          ) VALUES (
            @id, @name, @folder_path, @width, @height,
            @frame_rate_num, @frame_rate_den, @doc_json, @created_at, @updated_at
          )`,
        )
        .run(values);
    } catch (error) {
      rmSync(folderPath, { recursive: true, force: true });
      throw error;
    }

    this.logger?.info('Created project', {
      id: project.id,
      folderPath,
    });
    return this.bundle(project);
  }

  list(): ProjectSummary[] {
    const rows = this.database
      .prepare(
        `SELECT p.*, (
          SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id
        ) AS asset_count
        FROM projects p
        ORDER BY p.updated_at DESC, p.created_at DESC`,
      )
      .all() as ProjectRow[];
    return rows.map(projectSummaryFromRow);
  }

  getSummary(id: string): ProjectSummary | null {
    const row = this.database
      .prepare(
        `SELECT p.*, (
          SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id
        ) AS asset_count
        FROM projects p WHERE p.id = ?`,
      )
      .get(id) as ProjectRow | undefined;
    return row ? projectSummaryFromRow(row) : null;
  }

  open(id: string): ProjectBundle | null {
    const row = this.database
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as ProjectRow | undefined;
    if (!row) {
      return null;
    }
    ensureProjectFolders(row.folder_path);
    return this.bundle(projectFromRow(row));
  }

  require(id: string): ProjectBundle {
    const bundle = this.open(id);
    if (!bundle) {
      throw new Error(`Project ${id} was not found.`);
    }
    return bundle;
  }

  folderFor(id: string): string | null {
    const row = this.database
      .prepare('SELECT folder_path FROM projects WHERE id = ?')
      .get(id) as { folder_path: string } | undefined;
    return row?.folder_path ?? null;
  }

  rename(id: string, name: string): ProjectSummary {
    const bundle = this.require(id);
    const updated = projectSchema.parse({
      ...bundle.project,
      name,
      updatedAt: this.now(),
    });
    this.saveProject(updated);
    const summary = this.getSummary(id);
    if (!summary) {
      throw new Error(`Project ${id} was not found after renaming.`);
    }
    return summary;
  }

  delete(id: string, options: { removeFolder?: boolean } = {}): boolean {
    const folderPath = this.folderFor(id);
    const result = this.database
      .prepare('DELETE FROM projects WHERE id = ?')
      .run(id);
    if (result.changes === 0) {
      return false;
    }

    if (
      options.removeFolder !== false &&
      folderPath &&
      isPathInside(this.projectsRoot, folderPath)
    ) {
      rmSync(folderPath, { recursive: true, force: true });
    }
    this.logger?.info('Deleted project', { id, folderPath });
    return true;
  }

  saveProject(project: Project): Project {
    const folderPath = this.folderFor(project.id);
    if (!folderPath) {
      throw new Error(`Project ${project.id} was not found.`);
    }
    const values = projectValues(project, folderPath);
    const result = this.database
      .prepare(
        `UPDATE projects SET
          name = @name,
          folder_path = @folder_path,
          width = @width,
          height = @height,
          frame_rate_num = @frame_rate_num,
          frame_rate_den = @frame_rate_den,
          doc_json = @doc_json,
          created_at = @created_at,
          updated_at = @updated_at
        WHERE id = @id`,
      )
      .run(values);
    if (result.changes === 0) {
      throw new Error(`Project ${project.id} was not found.`);
    }
    return project;
  }

  listAssets(projectId: string): Asset[] {
    const rows = this.database
      .prepare(
        'SELECT * FROM assets WHERE project_id = ? ORDER BY created_at ASC',
      )
      .all(projectId) as ChildRow[];
    return rows.map(assetFromRow);
  }

  findAsset(assetId: string): Asset | null {
    const row = this.database
      .prepare('SELECT * FROM assets WHERE id = ?')
      .get(assetId) as ChildRow | undefined;
    return row ? assetFromRow(row) : null;
  }

  saveAsset(asset: Asset): Asset {
    this.database
      .prepare(
        `INSERT INTO assets (
          id, project_id, kind, name, path, duration_frames, width, height,
          frame_rate_num, frame_rate_den, metadata_json, payload_json, created_at
        ) VALUES (
          @id, @project_id, @kind, @name, @path, @duration_frames, @width,
          @height, @frame_rate_num, @frame_rate_den, @metadata_json,
          @payload_json, @created_at
        )
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          kind = excluded.kind,
          name = excluded.name,
          path = excluded.path,
          duration_frames = excluded.duration_frames,
          width = excluded.width,
          height = excluded.height,
          frame_rate_num = excluded.frame_rate_num,
          frame_rate_den = excluded.frame_rate_den,
          metadata_json = excluded.metadata_json,
          payload_json = excluded.payload_json`,
      )
      .run({
        id: asset.id,
        project_id: asset.projectId,
        kind: asset.kind,
        name: asset.name,
        path: asset.sourcePath,
        duration_frames: frameDuration(asset),
        width: asset.width,
        height: asset.height,
        frame_rate_num: asset.frameRate?.numerator ?? null,
        frame_rate_den: asset.frameRate?.denominator ?? null,
        metadata_json: '{}',
        payload_json: JSON.stringify(asset),
        created_at: asset.importedAt,
      });
    return asset;
  }

  deleteAsset(assetId: string): boolean {
    return (
      this.database.prepare('DELETE FROM assets WHERE id = ?').run(assetId)
        .changes > 0
    );
  }

  listTranscripts(projectId: string): Transcript[] {
    const rows = this.database
      .prepare(
        `SELECT t.* FROM transcripts t
         JOIN assets a ON a.id = t.asset_id
         WHERE a.project_id = ? ORDER BY t.created_at ASC`,
      )
      .all(projectId) as ChildRow[];
    return rows.map(transcriptFromRow);
  }

  saveTranscript(transcript: Transcript): Transcript {
    this.database
      .prepare(
        `INSERT INTO transcripts (
          id, asset_id, language, text, words_json, payload_json, created_at
        ) VALUES (
          @id, @asset_id, @language, @text, @words_json, @payload_json, @created_at
        )
        ON CONFLICT(id) DO UPDATE SET
          asset_id = excluded.asset_id,
          language = excluded.language,
          text = excluded.text,
          words_json = excluded.words_json,
          payload_json = excluded.payload_json`,
      )
      .run({
        id: transcript.id,
        asset_id: transcript.assetId,
        language: transcript.language,
        text: transcript.text,
        words_json: JSON.stringify(
          transcript.segments.flatMap((segment) => segment.words),
        ),
        payload_json: JSON.stringify(transcript),
        created_at: transcript.createdAt,
      });
    return transcript;
  }

  listScenes(projectId: string): Scene[] {
    const rows = this.database
      .prepare(
        `SELECT s.* FROM scenes s
         JOIN assets a ON a.id = s.asset_id
         WHERE a.project_id = ? ORDER BY s.start_frame ASC`,
      )
      .all(projectId) as ChildRow[];
    return rows.map(sceneFromRow);
  }

  saveScene(scene: Scene): Scene {
    this.database
      .prepare(
        `INSERT INTO scenes (
          id, asset_id, start_frame, end_frame, description, confidence,
          payload_json, created_at
        ) VALUES (
          @id, @asset_id, @start_frame, @end_frame, @description, @confidence,
          @payload_json, @created_at
        )
        ON CONFLICT(id) DO UPDATE SET
          asset_id = excluded.asset_id,
          start_frame = excluded.start_frame,
          end_frame = excluded.end_frame,
          description = excluded.description,
          confidence = excluded.confidence,
          payload_json = excluded.payload_json`,
      )
      .run({
        id: scene.id,
        asset_id: scene.assetId,
        start_frame: scene.startFrame,
        end_frame: scene.endFrame,
        description: '',
        confidence: scene.score,
        payload_json: JSON.stringify(scene),
        created_at: this.now(),
      });
    return scene;
  }

  listBeatMaps(projectId: string): BeatMap[] {
    const rows = this.database
      .prepare(
        `SELECT b.* FROM beat_maps b
         JOIN assets a ON a.id = b.asset_id
         WHERE a.project_id = ? ORDER BY b.created_at ASC`,
      )
      .all(projectId) as ChildRow[];
    return rows.map(beatMapFromRow);
  }

  saveBeatMap(beatMap: BeatMap): BeatMap {
    this.database
      .prepare(
        `INSERT INTO beat_maps (
          id, asset_id, bpm, offset_frames, beats_json, payload_json, created_at
        ) VALUES (
          @id, @asset_id, @bpm, @offset_frames, @beats_json, @payload_json,
          @created_at
        )
        ON CONFLICT(id) DO UPDATE SET
          asset_id = excluded.asset_id,
          bpm = excluded.bpm,
          offset_frames = excluded.offset_frames,
          beats_json = excluded.beats_json,
          payload_json = excluded.payload_json`,
      )
      .run({
        id: beatMap.id,
        asset_id: beatMap.assetId,
        bpm: beatMap.bpm,
        offset_frames: beatMap.offsetFrames,
        beats_json: JSON.stringify(beatMap.beats),
        payload_json: JSON.stringify(beatMap),
        created_at: beatMap.createdAt,
      });
    return beatMap;
  }

  listReferenceProfiles(projectId: string): ReferenceProfile[] {
    const rows = this.database
      .prepare(
        'SELECT * FROM reference_profiles WHERE project_id = ? ORDER BY created_at ASC',
      )
      .all(projectId) as ChildRow[];
    return rows.map(referenceProfileFromRow);
  }

  saveReferenceProfile(
    projectId: string,
    profile: ReferenceProfile,
  ): ReferenceProfile {
    this.database
      .prepare(
        `INSERT INTO reference_profiles (
          id, project_id, name, payload_json, created_at
        ) VALUES (@id, @project_id, @name, @payload_json, @created_at)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          name = excluded.name,
          payload_json = excluded.payload_json`,
      )
      .run({
        id: profile.id,
        project_id: projectId,
        name: profile.name,
        payload_json: JSON.stringify(profile),
        created_at: profile.createdAt,
      });
    return profile;
  }

  commitEdit(project: Project, entry: EditLogEntryInput): void {
    const folderPath = this.folderFor(project.id);
    if (!folderPath) {
      throw new Error(`Project ${project.id} was not found.`);
    }

    const transaction = this.database.transaction(() => {
      const values = projectValues(project, folderPath);
      this.database
        .prepare(
          `UPDATE projects SET
            name = @name, width = @width, height = @height,
            frame_rate_num = @frame_rate_num, frame_rate_den = @frame_rate_den,
            doc_json = @doc_json, updated_at = @updated_at
          WHERE id = @id`,
        )
        .run(values);

      this.database
        .prepare(
          `INSERT INTO edit_log (
            id, project_id, command_id, actor, label, command_json,
            inverse_json, created_at
          ) VALUES (
            @id, @project_id, @command_id, @actor, @label, @command_json,
            @inverse_json, @created_at
          )`,
        )
        .run({
          id: entry.id,
          project_id: project.id,
          command_id: entry.commandId,
          actor: entry.actor,
          label: entry.label,
          command_json: JSON.stringify(entry.command),
          inverse_json:
            entry.inverse === null ? null : JSON.stringify(entry.inverse),
          created_at: entry.createdAt,
        });
    });
    transaction();
  }

  listEditLog(projectId: string, limit = 100): EditLogRecord[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM edit_log WHERE project_id = ?
         ORDER BY seq DESC LIMIT ?`,
      )
      .all(projectId, Math.max(1, Math.min(limit, 1_000))) as Array<{
      seq: number;
      id: string;
      project_id: string;
      command_id: string;
      actor: string;
      label: string;
      command_json: string;
      inverse_json: string | null;
      created_at: number;
    }>;
    return rows.reverse().map((row) => ({
      sequence: row.seq,
      id: row.id,
      projectId: row.project_id,
      commandId: row.command_id,
      actor: row.actor,
      label: row.label,
      command: readJson(row.command_json) as EditCommand,
      inverse:
        row.inverse_json === null
          ? null
          : (readJson(row.inverse_json) as EditCommand | null),
      createdAt: row.created_at,
    }));
  }

  private bundle(project: Project): ProjectBundle {
    return {
      project,
      assets: this.listAssets(project.id),
      transcripts: this.listTranscripts(project.id),
      scenes: this.listScenes(project.id),
      beatMaps: this.listBeatMaps(project.id),
      referenceProfiles: this.listReferenceProfiles(project.id),
    };
  }
}
