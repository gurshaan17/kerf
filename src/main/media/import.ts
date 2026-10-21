import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Asset, ProjectId } from '@kerf/model';
import {
  assetKindFromPath,
  assetSchema,
  createAsset,
  EMPTY_ASSET_CACHE,
  fileNameFromPath,
} from '@kerf/model';
import type { ProjectRepository } from '../projects';
import type { JobContext, JobQueue } from '../jobs';
import type { JobSummary } from '../../shared/contracts';
import { MediaProcessError, probeMedia } from './ffmpeg';
import {
  assetCachePaths,
  generateProxy,
  generateThumbnail,
  generateWaveform,
} from './generate';

export interface MediaImportServiceOptions {
  readonly repository: ProjectRepository;
  readonly jobs: JobQueue;
  readonly onAssetsChanged?: (projectId: string) => void;
  readonly now?: () => number;
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
}

interface IngestPayload {
  readonly assetId: string;
}

interface PreparedFile {
  readonly sourcePath: string;
  readonly fileSize: number;
  readonly mtimeMs: number;
  readonly kind: Asset['kind'];
}

function isCancelled(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof MediaProcessError && error.code === 'cancelled')
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(): Error {
  const error = new Error('The import was cancelled.');
  error.name = 'AbortError';
  return error;
}

export async function hashFile(
  filePath: string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    throw abortError();
  }
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) {
        throw abortError();
      }
      hash.update(chunk as Buffer);
    }
  } finally {
    stream.destroy();
  }
  return hash.digest('hex');
}

export class MediaImportService {
  private readonly repository: ProjectRepository;
  private readonly jobs: JobQueue;
  private readonly onAssetsChanged?: (projectId: string) => void;
  private readonly now: () => number;
  private readonly ffmpegPath?: string;
  private readonly ffprobePath?: string;

  constructor(options: MediaImportServiceOptions) {
    this.repository = options.repository;
    this.jobs = options.jobs;
    this.onAssetsChanged = options.onAssetsChanged;
    this.now = options.now ?? Date.now;
    this.ffmpegPath = options.ffmpegPath;
    this.ffprobePath = options.ffprobePath;
    this.jobs.registerHandler('ingest', (payload, context) =>
      this.ingest(payload, context),
    );
    this.jobs.subscribe((job) => this.handleJobChange(job));
  }

  /**
   * Reflects the filesystem in the asset rows. A vanished source is marked
   * missing without losing its metadata or thumbnails; a source that comes
   * back is re-ingested so every cache path is valid again.
   */
  async refreshAvailability(projectId: string): Promise<Asset[]> {
    const assets = this.repository.listAssets(projectId);
    const refreshed: Asset[] = [];

    for (const asset of assets) {
      let available = false;
      try {
        const info = await stat(asset.sourcePath);
        available = info.isFile();
      } catch {
        available = false;
      }

      if (!available) {
        refreshed.push(
          asset.status === 'missing'
            ? asset
            : this.save(asset, {
                status: 'missing',
                error: 'The source file is missing or unavailable.',
              }),
        );
        continue;
      }

      if (asset.status === 'missing') {
        const queued = this.save(asset, {
          status: 'queued',
          error: null,
          cache: { ...EMPTY_ASSET_CACHE },
        });
        this.jobs.enqueue({
          projectId,
          kind: 'ingest',
          payload: { assetId: asset.id } satisfies IngestPayload,
        });
        refreshed.push(queued);
        continue;
      }

      refreshed.push(asset);
    }

    return refreshed;
  }

  async relink(assetId: string, sourcePath: string): Promise<Asset> {
    const asset = this.repository.findAsset(assetId);
    if (!asset) {
      throw new Error('The asset was not found.');
    }
    const resolved = resolve(sourcePath);
    const info = await stat(resolved);
    if (!info.isFile()) {
      throw new Error(`Not a file: ${resolved}`);
    }
    const kind = assetKindFromPath(resolved);
    if (kind === 'other') {
      throw new Error(`Unsupported media file: ${fileNameFromPath(resolved)}`);
    }
    if (kind !== asset.kind) {
      throw new Error(`Choose a ${asset.kind} file to relink ${asset.name}.`);
    }

    const contentHash = await hashFile(resolved);
    const next = this.save(asset, {
      sourcePath: resolved,
      fileSize: info.size,
      mtimeMs: info.mtimeMs,
      contentHash,
      status: 'queued',
      error: null,
      cache: { ...EMPTY_ASSET_CACHE },
    });
    this.jobs.enqueue({
      projectId: asset.projectId,
      kind: 'ingest',
      payload: { assetId: asset.id } satisfies IngestPayload,
    });
    return next;
  }

  async importFiles(
    projectId: string,
    paths: readonly string[],
  ): Promise<Asset[]> {
    if (paths.length === 0) {
      return [];
    }

    const project = this.repository.require(projectId).project;
    const prepared: PreparedFile[] = [];
    for (const path of paths) {
      const sourcePath = resolve(path);
      const info = await stat(sourcePath);
      if (!info.isFile()) {
        throw new Error(`Not a file: ${sourcePath}`);
      }
      const kind = assetKindFromPath(sourcePath);
      if (kind === 'other') {
        throw new Error(
          `Unsupported media file: ${fileNameFromPath(sourcePath)}`,
        );
      }
      prepared.push({
        sourcePath,
        fileSize: info.size,
        mtimeMs: info.mtimeMs,
        kind,
      });
    }

    const existing = this.repository.listAssets(projectId);
    const imported: Asset[] = [];

    for (const file of prepared) {
      const samePath = existing.find(
        (asset) => asset.sourcePath === file.sourcePath,
      );
      const sameFile =
        samePath &&
        samePath.fileSize === file.fileSize &&
        Math.abs(samePath.mtimeMs - file.mtimeMs) < 1;

      if (
        sameFile &&
        samePath.status !== 'missing' &&
        samePath.status !== 'error'
      ) {
        imported.push(samePath);
        continue;
      }

      const contentHash = await hashFile(file.sourcePath);
      const sameContent = existing.find(
        (asset) =>
          asset.contentHash === contentHash &&
          asset.fileSize === file.fileSize &&
          asset.sourcePath !== file.sourcePath,
      );
      if (sameContent) {
        imported.push(sameContent);
        continue;
      }

      let asset: Asset;
      if (samePath) {
        asset = assetSchema.parse({
          ...samePath,
          kind: file.kind,
          fileSize: file.fileSize,
          mtimeMs: file.mtimeMs,
          contentHash,
          status: 'queued',
          error: null,
          cache: { ...EMPTY_ASSET_CACHE },
          updatedAt: this.now(),
        });
      } else {
        asset = assetSchema.parse({
          ...createAsset({
            projectId: project.id as ProjectId,
            name: fileNameFromPath(file.sourcePath),
            sourcePath: file.sourcePath,
            kind: file.kind,
            now: this.now(),
            fileSize: file.fileSize,
            mtimeMs: file.mtimeMs,
          }),
          contentHash,
        });
      }

      this.repository.saveAsset(asset);
      existing.push(asset);
      imported.push(asset);
      this.jobs.enqueue({
        projectId,
        kind: 'ingest',
        payload: { assetId: asset.id } satisfies IngestPayload,
      });
    }

    this.notify(projectId);
    return imported;
  }

  private async ingest(payload: unknown, context: JobContext): Promise<void> {
    const assetId = this.assetIdFromPayload(payload);
    const asset = this.repository.findAsset(assetId);
    if (!asset) {
      throw new Error('The imported asset was not found.');
    }
    const folder = this.repository.folderFor(asset.projectId);
    if (!folder) {
      throw new Error('The project folder was not found.');
    }

    try {
      context.update(0.01, 'probe');
      let current = this.save(asset, { status: 'probing', error: null });
      const probe = await probeMedia(current.sourcePath, {
        ffprobePath: this.ffprobePath,
        signal: context.signal,
      });
      current = this.save(current, {
        status: 'processing',
        durationSeconds: current.kind === 'image' ? 0 : probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        frameRate: probe.frameRate,
        hasVideo: probe.hasVideo,
        hasAudio: probe.hasAudio,
        streams: probe.streams,
        error: null,
      });

      const cache = assetCachePaths(folder, current.id);
      const nextCache = { ...EMPTY_ASSET_CACHE };

      if (current.kind === 'video') {
        context.update(0.08, 'proxy');
        await generateProxy(current.sourcePath, cache.proxyPath!, {
          ffmpegPath: this.ffmpegPath,
          signal: context.signal,
          durationSeconds: probe.durationSeconds,
          hasAudio: probe.hasAudio,
          onProgress: (progress) =>
            context.update(0.08 + progress * 0.6, 'proxy'),
        });
        nextCache.proxyPath = cache.proxyPath;
        context.update(0.7, 'thumbnail');
      }

      if (current.kind === 'image') {
        context.update(0.1, 'thumbnail');
        await generateThumbnail(current.sourcePath, cache.thumbnailPath!, {
          ffmpegPath: this.ffmpegPath,
          signal: context.signal,
          isImage: true,
        });
        nextCache.thumbnailPath = cache.thumbnailPath;
        context.update(0.9, 'thumbnail');
      } else if (current.kind === 'video') {
        await generateThumbnail(current.sourcePath, cache.thumbnailPath!, {
          ffmpegPath: this.ffmpegPath,
          signal: context.signal,
          atSeconds:
            probe.durationSeconds > 1
              ? 1
              : Math.max(0, probe.durationSeconds / 2),
        });
        nextCache.thumbnailPath = cache.thumbnailPath;
        context.update(0.8, 'thumbnail');
      } else {
        context.update(0.25, 'waveform');
      }

      if (probe.hasAudio) {
        context.update(current.kind === 'audio' ? 0.3 : 0.84, 'waveform');
        await generateWaveform(current.sourcePath, cache.waveformPath!, {
          ffmpegPath: this.ffmpegPath,
          signal: context.signal,
        });
        nextCache.waveformPath = cache.waveformPath;
        context.update(0.96, 'waveform');
      }

      current = this.save(current, {
        status: 'ready',
        cache: nextCache,
        error: null,
      });
      context.update(1, 'done');
      this.notify(current.projectId);
    } catch (error) {
      const latest = this.repository.findAsset(assetId);
      if (latest) {
        if (context.signal.aborted || isCancelled(error)) {
          this.save(latest, {
            status: 'queued',
            error: null,
            cache: { ...EMPTY_ASSET_CACHE },
          });
        } else {
          this.save(latest, {
            status: 'error',
            error: errorText(error),
          });
        }
      }
      throw error;
    }
  }

  private save(asset: Asset, patch: Partial<Asset>): Asset {
    const next = assetSchema.parse({
      ...asset,
      ...patch,
      updatedAt: this.now(),
    });
    this.repository.saveAsset(next);
    this.notify(next.projectId);
    return next;
  }

  private handleJobChange(job: JobSummary): void {
    if (job.kind !== 'ingest' || job.status !== 'cancelled' || !job.targetId) {
      return;
    }
    const asset = this.repository.findAsset(job.targetId);
    if (
      !asset ||
      (asset.status !== 'queued' &&
        asset.status !== 'probing' &&
        asset.status !== 'processing')
    ) {
      return;
    }
    this.save(asset, {
      status: 'error',
      error: 'The import was cancelled.',
    });
  }

  private notify(projectId: string): void {
    this.onAssetsChanged?.(projectId);
  }

  private assetIdFromPayload(payload: unknown): string {
    if (
      payload &&
      typeof payload === 'object' &&
      'assetId' in payload &&
      typeof payload.assetId === 'string'
    ) {
      return payload.assetId;
    }
    throw new Error('The ingest job has no asset identifier.');
  }
}
