import type { Asset, Scene, Transcript, TranscriptWord } from '@kerf/model';
import type { SqliteDatabase } from '../db';
import type {
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '../../shared/contracts';
import type { ProjectRepository } from '../projects/repository';

interface FtsRow {
  text: string;
  asset_id: string;
  start_frame: number;
  end_frame: number;
  rank: number;
}

export interface SearchServiceOptions {
  readonly database: SqliteDatabase;
  readonly repository: ProjectRepository;
  readonly fts5Enabled?: boolean;
}

function transcriptWindows(
  transcript: Transcript,
): Array<{ text: string; startFrame: number; endFrame: number; id: string }> {
  const words: TranscriptWord[] = transcript.segments.flatMap(
    (segment) => segment.words,
  );
  if (words.length === 0) {
    return transcript.segments.map((segment) => ({
      id: segment.id,
      text: segment.text,
      startFrame: segment.startFrame,
      endFrame: segment.endFrame,
    }));
  }
  const windows: Array<{
    text: string;
    startFrame: number;
    endFrame: number;
    id: string;
  }> = [];
  for (let index = 0; index < words.length; index += 8) {
    const chunk = words.slice(index, index + 8);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) {
      continue;
    }
    windows.push({
      id: `${transcript.id}:${index}`,
      text: chunk.map((word) => word.text).join(' '),
      startFrame: first.startFrame,
      endFrame: last.endFrame,
    });
  }
  return windows;
}

function normalizeQuery(query: string): string[] {
  return (
    query
      .toLowerCase()
      .match(/[\p{L}\p{N}']+/gu)
      ?.filter((word) => word.length > 0)
      .slice(0, 12) ?? []
  );
}

function phraseQuery(words: readonly string[]): string {
  return `"${words.join(' ').replaceAll('"', '""')}"`;
}

function termQuery(words: readonly string[]): string {
  return words.map((word) => `${word.replaceAll('"', '""')}*`).join(' AND ');
}

export class SearchService {
  private readonly database: SqliteDatabase;
  private readonly repository: ProjectRepository;
  private readonly fts5Enabled: boolean;

  constructor(options: SearchServiceOptions) {
    this.database = options.database;
    this.repository = options.repository;
    this.fts5Enabled = options.fts5Enabled ?? true;
  }

  get vectorSearch(): boolean {
    return false;
  }

  reindexProject(projectId: string): void {
    if (!this.fts5Enabled) {
      return;
    }
    try {
      const transcripts = this.repository.listTranscripts(projectId);
      const scenes = this.repository.listScenes(projectId);
      const transaction = this.database.transaction(() => {
        this.database
          .prepare('DELETE FROM transcript_fts WHERE project_id = ?')
          .run(projectId);
        this.database
          .prepare('DELETE FROM scene_fts WHERE project_id = ?')
          .run(projectId);
        const insertTranscript = this.database.prepare(
          `INSERT INTO transcript_fts (
            text, project_id, asset_id, transcript_id, start_frame, end_frame
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const transcript of transcripts) {
          for (const window of transcriptWindows(transcript)) {
            insertTranscript.run(
              window.text,
              projectId,
              transcript.assetId,
              window.id,
              window.startFrame,
              window.endFrame,
            );
          }
        }
        const insertScene = this.database.prepare(
          `INSERT INTO scene_fts (
            text, project_id, asset_id, scene_id, start_frame, end_frame
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const scene of scenes) {
          if (scene.description && scene.description.trim().length > 0) {
            insertScene.run(
              scene.description,
              projectId,
              scene.assetId,
              scene.id,
              scene.startFrame,
              scene.endFrame,
            );
          }
        }
      });
      transaction();
    } catch {
      // A database built without FTS5 still supports the LIKE fallback.
    }
  }

  search(projectId: string, request: SearchRequest): SearchResponse {
    const words = normalizeQuery(request.query);
    if (words.length === 0) {
      return { results: [], vectorSearch: false };
    }
    const limit = Math.max(1, Math.min(request.limit ?? 40, 100));
    const assets = new Map(
      this.repository
        .listAssets(projectId)
        .map((asset) => [asset.id, asset] as const),
    );
    let transcriptRows: FtsRow[] = [];
    let sceneRows: FtsRow[] = [];
    if (this.fts5Enabled) {
      transcriptRows = this.fts('transcript_fts', projectId, words, limit);
      sceneRows = this.fts('scene_fts', projectId, words, limit);
    }
    if (transcriptRows.length === 0 && sceneRows.length === 0) {
      const lexical = this.lexical(projectId, words, limit);
      transcriptRows = lexical.transcripts;
      sceneRows = lexical.scenes;
    }
    return {
      results: this.fuse(assets, transcriptRows, sceneRows, limit),
      vectorSearch: this.vectorSearch,
    };
  }

  private fts(
    table: 'transcript_fts' | 'scene_fts',
    projectId: string,
    words: readonly string[],
    limit: number,
  ): FtsRow[] {
    const sql = `SELECT text, asset_id, start_frame, end_frame,
      bm25(${table}) AS rank
      FROM ${table}
      WHERE ${table} MATCH ? AND project_id = ?
      ORDER BY rank LIMIT ?`;
    const run = (query: string): FtsRow[] => {
      try {
        return this.database
          .prepare(sql)
          .all(query, projectId, limit) as FtsRow[];
      } catch {
        return [];
      }
    };
    const phrase = run(phraseQuery(words));
    if (phrase.length > 0) {
      return phrase;
    }
    return run(termQuery(words));
  }

  private lexical(
    projectId: string,
    words: readonly string[],
    limit: number,
  ): { transcripts: FtsRow[]; scenes: FtsRow[] } {
    const needle = words.join(' ');
    const transcripts: FtsRow[] = [];
    for (const transcript of this.repository.listTranscripts(projectId)) {
      for (const window of transcriptWindows(transcript)) {
        const index = window.text.toLowerCase().indexOf(needle);
        if (index >= 0) {
          transcripts.push({
            text: window.text,
            asset_id: transcript.assetId,
            start_frame: window.startFrame,
            end_frame: window.endFrame,
            rank: index + transcripts.length * 0.001,
          });
        }
        if (transcripts.length >= limit) {
          break;
        }
      }
    }
    const scenes: FtsRow[] = [];
    for (const scene of this.repository.listScenes(projectId)) {
      if (!scene.description) {
        continue;
      }
      const index = scene.description.toLowerCase().indexOf(needle);
      if (index >= 0) {
        scenes.push({
          text: scene.description,
          asset_id: scene.assetId,
          start_frame: scene.startFrame,
          end_frame: scene.endFrame,
          rank: index + scenes.length * 0.001,
        });
      }
      if (scenes.length >= limit) {
        break;
      }
    }
    return { transcripts, scenes };
  }

  private fuse(
    assets: ReadonlyMap<string, Asset>,
    transcripts: readonly FtsRow[],
    scenes: readonly FtsRow[],
    limit: number,
  ): SearchResult[] {
    const ranked = [
      ...transcripts.map((row, rank) => ({
        row,
        kind: 'transcript' as const,
        rank,
      })),
      ...scenes.map((row, rank) => ({ row, kind: 'scene' as const, rank })),
    ];
    return ranked
      .map(({ row, kind, rank }) => {
        const asset = assets.get(row.asset_id);
        return {
          id: `${kind}:${row.asset_id}:${row.start_frame}:${rank}`,
          kind,
          assetId: row.asset_id,
          assetName: asset?.name ?? 'Unknown asset',
          text: row.text,
          startFrame: row.start_frame,
          endFrame: row.end_frame,
          score: 1 / (60 + rank + 1),
          thumbnailPath: asset?.cache.thumbnailPath ?? null,
        } satisfies SearchResult;
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}

export function groupScenes(scenes: readonly Scene[]): Map<string, Scene[]> {
  const grouped = new Map<string, Scene[]>();
  for (const scene of scenes) {
    const existing = grouped.get(scene.assetId) ?? [];
    existing.push(scene);
    grouped.set(scene.assetId, existing);
  }
  return grouped;
}
