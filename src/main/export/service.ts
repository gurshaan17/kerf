import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { newId } from '@kerf/model';
import type { Asset, Sequence } from '@kerf/model';
import { fpsToNumber } from '@kerf/model';
import { sequenceDurationFrames } from '@kerf/engine';
import { MediaProcessError, findExecutable, runFfmpeg } from '../media/ffmpeg';
import type { ProjectRepository } from '../projects/repository';
import type { ProjectService } from '../projects/service';
import {
  clampExportWindow,
  resolveExportPreset,
  suggestedExportName,
} from '../../shared/export-plan';
import type { ResolvedExportPreset } from '../../shared/export-plan';
import type {
  ExportEvent,
  ExportFrame,
  ExportRecord,
  ExportStartRequest,
  ExportStartResult,
} from '../../shared/contracts';
import { buildExportAudioPlan } from './audio-plan';
import { buildExportArgs } from './args';
import type { ExportEncodePlan } from './args';

const MAX_EXPORT_FRAME_BATCH = 16;

export interface ExportEncodeOptions {
  readonly signal: AbortSignal;
  readonly durationSeconds: number;
  readonly onProgress: (progress: number) => void;
}

export type ExportEncoder = (
  plan: ExportEncodePlan,
  options: ExportEncodeOptions,
) => Promise<void>;

export interface ExportServiceOptions {
  readonly repository: ProjectRepository;
  readonly projects: ProjectService;
  readonly now?: () => number;
  readonly onEvent?: (event: ExportEvent) => void;
  readonly ffmpegPath?: string;
  readonly encode?: ExportEncoder;
}

interface ExportSession {
  record: ExportRecord;
  readonly preset: ResolvedExportPreset;
  readonly projectId: string;
  readonly projectFolder: string;
  readonly tempDirectory: string;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly frameCount: number;
  readonly durationSeconds: number;
  readonly sequence: Sequence;
  readonly assets: readonly Asset[];
  readonly controller: AbortController;
  framesWritten: number;
  encodingStarted: boolean;
  cancelled: boolean;
  finalized: boolean;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function timestampName(now: number): string {
  return new Date(now)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function normaliseOutputPath(
  projectName: string,
  projectFolder: string,
  preset: ResolvedExportPreset,
  requested: string | null | undefined,
  now: number,
): string {
  if (requested?.trim()) {
    const path = isAbsolute(requested) ? requested : resolve(requested);
    return extname(path).toLowerCase() === '.mp4' ? path : `${path}.mp4`;
  }
  const name = suggestedExportName(projectName, preset.name).replace(
    /\.mp4$/i,
    `-${timestampName(now)}.mp4`,
  );
  return join(projectFolder, 'exports', name);
}

/**
 * Owns one export at a time. The renderer supplies composited PNG frames; this
 * service writes them to disk, then runs a single ffmpeg pass for video and
 * timeline audio. Records live in SQLite so export history survives restarts.
 */
export class ExportService {
  private readonly repository: ProjectRepository;
  private readonly projects: ProjectService;
  private readonly now: () => number;
  private readonly onEvent?: (event: ExportEvent) => void;
  private readonly encoder: ExportEncoder;
  private readonly listeners = new Set<(event: ExportEvent) => void>();
  private active: ExportSession | null = null;

  constructor(options: ExportServiceOptions) {
    this.repository = options.repository;
    this.projects = options.projects;
    this.now = options.now ?? Date.now;
    this.onEvent = options.onEvent;
    this.encoder =
      options.encode ??
      (async (plan, encodeOptions) => {
        const ffmpegPath = options.ffmpegPath ?? findExecutable('ffmpeg');
        await runFfmpeg(ffmpegPath, buildExportArgs(plan), {
          signal: encodeOptions.signal,
          durationSeconds: encodeOptions.durationSeconds,
          onProgress: encodeOptions.onProgress,
        });
      });
  }

  subscribe(listener: (event: ExportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  list(projectId?: string): ExportRecord[] {
    const id = projectId ?? this.projects.current()?.project.id;
    return id ? this.repository.listExports(id) : [];
  }

  get(id: string): ExportRecord | null {
    return this.repository.findExport(id);
  }

  suggestedPath(presetId: string): string {
    const active = this.requireProject();
    const preset = resolveExportPreset(
      presetId,
      active.project.sequence.width,
      active.project.sequence.height,
    );
    const folder = this.repository.folderFor(active.project.id);
    if (!folder) {
      throw new Error('The project folder was not found.');
    }
    return join(
      folder,
      'exports',
      suggestedExportName(active.project.name, preset.name).replace(
        /\.mp4$/i,
        `-${timestampName(this.now())}.mp4`,
      ),
    );
  }

  start(request: ExportStartRequest): ExportStartResult {
    if (this.active) {
      throw new Error('Finish or cancel the current export first.');
    }
    const active = this.requireProject();
    const sequence = active.project.sequence;
    const duration = sequenceDurationFrames(sequence);
    const window = clampExportWindow(
      request.startFrame,
      request.endFrame,
      duration,
    );
    const preset = resolveExportPreset(
      request.presetId,
      sequence.width,
      sequence.height,
    );
    const folder = this.repository.folderFor(active.project.id);
    if (!folder) {
      throw new Error('The project folder was not found.');
    }

    const outputPath = normaliseOutputPath(
      active.project.name,
      folder,
      preset,
      request.outputPath,
      this.now(),
    );
    mkdirSync(dirname(outputPath), { recursive: true });
    const id = newId('export');
    const tempDirectory = join(folder, 'cache', 'exports', id);
    rmSync(tempDirectory, { recursive: true, force: true });
    mkdirSync(join(tempDirectory, 'frames'), { recursive: true });

    const record: ExportRecord = {
      id,
      projectId: active.project.id,
      preset: preset.id,
      outputPath,
      status: 'rendering',
      progress: 0,
      error: null,
      createdAt: this.now(),
      completedAt: null,
    };
    this.repository.saveExport(record);
    const fps = fpsToNumber(sequence.frameRate);
    const session: ExportSession = {
      record,
      preset,
      projectId: active.project.id,
      projectFolder: folder,
      tempDirectory,
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      frameCount: window.frameCount,
      durationSeconds: window.frameCount / fps,
      sequence,
      assets: active.assets,
      controller: new AbortController(),
      framesWritten: 0,
      encodingStarted: false,
      cancelled: false,
      finalized: false,
    };
    this.active = session;
    this.emit(record);

    return {
      export: record,
      width: preset.width,
      height: preset.height,
      frameRate: sequence.frameRate,
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      frameCount: window.frameCount,
    };
  }

  async writeFrame(id: string, index: number, data: Uint8Array): Promise<void> {
    await this.writeFrames(id, [{ index, data }]);
  }

  async writeFrames(id: string, frames: readonly ExportFrame[]): Promise<void> {
    const session = this.requireSession(id);
    if (session.cancelled) {
      throw new Error('The export was cancelled.');
    }
    if (frames.length === 0) {
      return;
    }
    if (frames.length > MAX_EXPORT_FRAME_BATCH) {
      throw new Error(
        `Export frames must arrive in batches of ${MAX_EXPORT_FRAME_BATCH} or fewer.`,
      );
    }

    const firstIndex = session.framesWritten;
    for (const [offset, frame] of frames.entries()) {
      const index = frame.index;
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= session.frameCount
      ) {
        throw new Error('The frame index is outside this export.');
      }
      if (index !== firstIndex + offset) {
        throw new Error('Export frames must arrive in order.');
      }
      if (!(frame.data instanceof Uint8Array)) {
        throw new Error('The exported frame data was not a byte buffer.');
      }
    }

    await Promise.all(
      frames.map((frame) =>
        writeFile(
          this.framePath(session, frame.index),
          Buffer.from(frame.data),
        ),
      ),
    );
    session.framesWritten += frames.length;
    this.update(session, {
      progress: (session.framesWritten / session.frameCount) * 0.8,
    });
  }

  async finish(id: string): Promise<ExportRecord> {
    const session = this.requireSession(id);
    if (session.framesWritten !== session.frameCount) {
      throw new Error(
        `Only ${session.framesWritten} of ${session.frameCount} frames were rendered.`,
      );
    }

    this.update(session, { status: 'encoding', progress: 0.8 });
    const plan: ExportEncodePlan = {
      framePattern: join(session.tempDirectory, 'frames', 'frame_%05d.png'),
      frameRate: fpsToNumber(session.sequence.frameRate),
      frameCount: session.frameCount,
      durationSeconds: session.durationSeconds,
      width: session.preset.width,
      height: session.preset.height,
      outputPath: session.record.outputPath,
      audioClips: buildExportAudioPlan(
        session.sequence,
        session.assets,
        session.startFrame,
        session.endFrame,
      ),
    };

    session.encodingStarted = true;
    try {
      await this.encoder(plan, {
        signal: session.controller.signal,
        durationSeconds: session.durationSeconds,
        onProgress: (progress) => {
          if (session.cancelled) {
            return;
          }
          this.update(session, {
            progress: 0.8 + Math.max(0, Math.min(1, progress)) * 0.2,
          });
        },
      });
      if (!existsSync(session.record.outputPath)) {
        throw new Error('The encoder did not produce an output file.');
      }
      return this.finalize(session, 'succeeded', 1, null);
    } catch (cause) {
      const cancelled =
        session.cancelled ||
        session.controller.signal.aborted ||
        (cause instanceof MediaProcessError && cause.code === 'cancelled');
      return this.finalize(
        session,
        cancelled ? 'cancelled' : 'failed',
        session.record.progress,
        cancelled ? null : errorMessage(cause),
      );
    }
  }

  cancel(id: string): boolean {
    const session = this.active;
    if (!session || session.record.id !== id || session.finalized) {
      return false;
    }
    session.cancelled = true;
    session.controller.abort();
    this.finalize(session, 'cancelled', session.record.progress, null);
    return true;
  }

  dispose(): void {
    if (this.active && !this.active.finalized) {
      this.cancel(this.active.record.id);
    }
  }

  private finalize(
    session: ExportSession,
    status: ExportRecord['status'],
    progress: number,
    error: string | null,
  ): ExportRecord {
    if (session.finalized) {
      return session.record;
    }
    session.finalized = true;
    const record: ExportRecord = {
      ...session.record,
      status,
      progress: Math.max(0, Math.min(1, progress)),
      error,
      completedAt: this.now(),
    };
    session.record = record;
    this.repository.saveExport(record);
    if (this.active === session) {
      this.active = null;
    }
    if (
      session.encodingStarted &&
      status !== 'succeeded' &&
      existsSync(record.outputPath)
    ) {
      rmSync(record.outputPath, { force: true });
    }
    rmSync(session.tempDirectory, { recursive: true, force: true });
    this.emit(record);
    return record;
  }

  private update(
    session: ExportSession,
    patch: Partial<Pick<ExportRecord, 'status' | 'progress'>>,
  ): void {
    if (session.finalized) {
      return;
    }
    const record: ExportRecord = { ...session.record, ...patch };
    session.record = record;
    this.repository.saveExport(record);
    this.emit(record);
  }

  private emit(record: ExportRecord): void {
    const event: ExportEvent = { type: 'export.changed', export: record };
    this.onEvent?.(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private requireProject() {
    const active = this.projects.current();
    if (!active) {
      throw new Error('Open a project before exporting.');
    }
    return active;
  }

  private framePath(session: ExportSession, index: number): string {
    return join(
      session.tempDirectory,
      'frames',
      `frame_${String(index + 1).padStart(5, '0')}.png`,
    );
  }

  private requireSession(id: string): ExportSession {
    const session = this.active;
    if (!session || session.record.id !== id || session.finalized) {
      throw new Error('This export is no longer running.');
    }
    return session;
  }
}
