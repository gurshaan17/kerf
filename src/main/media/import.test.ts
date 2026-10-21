import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db';
import type { DatabaseHandle } from '../db';
import { JobQueue } from '../jobs';
import { ProjectRepository } from '../projects';
import { findMediaTools, runProcess } from './ffmpeg';
import type { MediaToolPaths } from './ffmpeg';
import { hashFile, MediaImportService } from './import';

const tempDirectories: string[] = [];

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kerf-import-'));
  tempDirectories.push(directory);
  return directory;
}

let tools: MediaToolPaths | null = null;
try {
  tools = findMediaTools();
} catch {
  tools = null;
}

interface ImportContext {
  readonly importer: MediaImportService;
  readonly repository: ProjectRepository;
  readonly queue: JobQueue;
  readonly database: DatabaseHandle;
  readonly projectId: string;
  readonly root: string;
}

const contexts: ImportContext[] = [];

function makeContext(): ImportContext {
  const root = makeTempDirectory();
  const database = openDatabase({ filename: join(root, 'kerf.db') });
  let now = 1_000;
  const clock = () => {
    now += 1;
    return now;
  };
  const repository = new ProjectRepository({
    database: database.connection,
    projectsRoot: join(root, 'projects'),
    now: clock,
  });
  const queue = new JobQueue({
    database: database.connection,
    now: clock,
  });
  const importer = new MediaImportService({
    repository,
    jobs: queue,
    now: clock,
    ffmpegPath: tools?.ffmpeg,
    ffprobePath: tools?.ffprobe,
  });
  const bundle = repository.create({ name: 'Import test', now: clock() });
  const context: ImportContext = {
    importer,
    repository,
    queue,
    database,
    projectId: bundle.project.id,
    root,
  };
  contexts.push(context);
  return context;
}

function cleanupContext(context: ImportContext): void {
  context.queue.stop();
  context.database.close();
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    cleanupContext(context);
    rmSync(context.root, { recursive: true, force: true });
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function waitFor(
  condition: () => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for ingest.');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const integration = tools ? it : it.skip;

describe('MediaImportService', () => {
  it('hashes files consistently', async () => {
    const directory = makeTempDirectory();
    const file = join(directory, 'sample.bin');
    writeFileSync(file, 'kerf');
    const first = await hashFile(file);
    const second = await hashFile(file);
    writeFileSync(file, 'kerf!');
    const changed = await hashFile(file);

    expect(first).toBe(second);
    expect(changed).not.toBe(first);
  });

  it('rejects unsupported files before creating rows', async () => {
    const context = makeContext();
    const text = join(context.root, 'notes.txt');
    writeFileSync(text, 'not media');

    await expect(
      context.importer.importFiles(context.projectId, [text]),
    ).rejects.toThrow(/Unsupported media file/);
    expect(context.repository.listAssets(context.projectId)).toEqual([]);
  });

  integration(
    'imports video, audio and image files, then deduplicates them',
    async () => {
      const context = makeContext();
      const fixtures = join(context.root, 'fixtures');
      mkdirSync(fixtures, { recursive: true });
      const video = join(fixtures, 'clip.mp4');
      const audio = join(fixtures, 'voice.wav');
      const image = join(fixtures, 'frame.png');

      await runProcess(tools!.ffmpeg, [
        '-hide_banner',
        '-nostdin',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=640x360:rate=24',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-t',
        '0.8',
        '-shortest',
        '-c:v',
        'mpeg4',
        '-c:a',
        'aac',
        '-pix_fmt',
        'yuv420p',
        video,
      ]);
      await runProcess(tools!.ffmpeg, [
        '-hide_banner',
        '-nostdin',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=220:sample_rate=48000',
        '-t',
        '0.5',
        audio,
      ]);
      await runProcess(tools!.ffmpeg, [
        '-hide_banner',
        '-nostdin',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=1',
        '-frames:v',
        '1',
        image,
      ]);

      const imported = await context.importer.importFiles(context.projectId, [
        video,
        audio,
        image,
      ]);
      expect(imported).toHaveLength(3);
      expect(imported.every((asset) => asset.status === 'queued')).toBe(true);
      expect(context.queue.list(context.projectId)).toHaveLength(3);

      context.queue.start();
      await waitFor(() =>
        context.repository
          .listAssets(context.projectId)
          .every((asset) => asset.status === 'ready'),
      );

      const assets = context.repository.listAssets(context.projectId);
      expect(assets.map((asset) => asset.kind).sort()).toEqual([
        'audio',
        'image',
        'video',
      ]);
      for (const asset of assets) {
        expect(asset.status).toBe('ready');
        expect(asset.contentHash).not.toBeNull();
        if (asset.kind === 'video') {
          expect(asset.cache.proxyPath).not.toBeNull();
          expect(asset.cache.thumbnailPath).not.toBeNull();
          expect(asset.cache.waveformPath).not.toBeNull();
          expect(statSync(asset.cache.proxyPath!).size).toBeGreaterThan(0);
        }
        if (asset.kind === 'audio') {
          expect(asset.cache.proxyPath).toBeNull();
          expect(asset.cache.thumbnailPath).toBeNull();
          expect(asset.cache.waveformPath).not.toBeNull();
        }
        if (asset.kind === 'image') {
          expect(asset.cache.proxyPath).toBeNull();
          expect(asset.cache.thumbnailPath).not.toBeNull();
          expect(asset.cache.waveformPath).toBeNull();
        }
      }
      expect(
        context.queue
          .list(context.projectId)
          .every((job) => job.status === 'succeeded'),
      ).toBe(true);

      const duplicate = await context.importer.importFiles(context.projectId, [
        video,
      ]);
      expect(duplicate[0]?.id).toBe(
        assets.find((asset) => asset.kind === 'video')?.id,
      );
      expect(context.repository.listAssets(context.projectId)).toHaveLength(3);
      expect(context.queue.list(context.projectId)).toHaveLength(3);
    },
    20_000,
  );

  integration(
    'marks a missing source and relinks it through a fresh ingest',
    async () => {
      const context = makeContext();
      const original = join(context.root, 'original.mp4');
      const relinked = join(context.root, 'relinked.mp4');
      await runProcess(tools!.ffmpeg, [
        '-hide_banner',
        '-nostdin',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=24',
        '-t',
        '0.5',
        '-c:v',
        'mpeg4',
        '-pix_fmt',
        'yuv420p',
        original,
      ]);

      const [imported] = await context.importer.importFiles(context.projectId, [
        original,
      ]);
      expect(imported).toBeDefined();
      context.queue.start();
      await waitFor(
        () => context.repository.findAsset(imported!.id)?.status === 'ready',
      );
      const ready = context.repository.findAsset(imported!.id)!;
      expect(ready.cache.thumbnailPath).not.toBeNull();

      renameSync(original, relinked);
      const missing = await context.importer.refreshAvailability(
        context.projectId,
      );
      expect(missing[0]?.status).toBe('missing');
      expect(missing[0]?.cache.thumbnailPath).toBe(ready.cache.thumbnailPath);
      expect(context.queue.list(context.projectId)).toHaveLength(1);

      const text = join(context.root, 'wrong.txt');
      writeFileSync(text, 'not media');
      await expect(context.importer.relink(ready.id, text)).rejects.toThrow(
        /Unsupported media file/,
      );

      const queued = await context.importer.relink(ready.id, relinked);
      expect(queued.status).toBe('queued');
      expect(queued.sourcePath).toBe(relinked);
      expect(queued.cache.proxyPath).toBeNull();
      await waitFor(
        () => context.repository.findAsset(ready.id)?.status === 'ready',
      );

      const restored = context.repository.findAsset(ready.id)!;
      expect(restored.sourcePath).toBe(relinked);
      expect(restored.cache.proxyPath).not.toBeNull();
      expect(statSync(restored.cache.proxyPath!).size).toBeGreaterThan(0);
      expect(context.queue.list(context.projectId)).toHaveLength(2);
    },
    20_000,
  );
});
