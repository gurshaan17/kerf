import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteModel,
  downloadModel,
  findWhisperBinary,
  installedModels,
  modelPath,
  modelRootFor,
  sha256File,
} from './whisper';

/** The GGML magic whisper.cpp expects at the start of every model file. */
const GGML_HEADER = Buffer.from('lmgg');

function fixtureChecksum(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

const directories: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kerf-whisper-'));
  directories.push(directory);
  return directory;
}

function executable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Whisper discovery and models', () => {
  it('finds an executable on PATH', () => {
    const directory = tempDirectory();
    const binary = join(directory, 'whisper-cli');
    executable(binary, '#!/bin/sh\nexit 0\n');

    expect(
      findWhisperBinary({
        env: {},
        pathEnv: directory,
        platform: 'darwin',
        useFallbackDirectories: false,
      }),
    ).toBe(binary);
  });

  it('rejects an invalid configured binary', () => {
    const directory = tempDirectory();
    expect(() =>
      findWhisperBinary({
        env: { KERF_WHISPER_PATH: join(directory, 'missing') },
        useFallbackDirectories: false,
      }),
    ).toThrow(/not executable/);
  });

  it('reports installed models and deletes them', () => {
    const root = modelRootFor(tempDirectory());
    mkdirSync(root, { recursive: true });
    const tiny = modelPath(root, 'tiny');
    expect(tiny).not.toBeNull();
    if (!tiny) {
      throw new Error('missing model path');
    }
    writeFileSync(tiny, GGML_HEADER);
    truncateSync(tiny, 77_691_713);

    const models = installedModels(root);
    expect(models.find((model) => model.id === 'tiny')?.installed).toBe(true);
    expect(statSync(tiny).size).toBe(77_691_713);
    expect(deleteModel(root, 'tiny')).toBe(true);
    expect(deleteModel(root, 'tiny')).toBe(false);
  });

  it('rejects a model of the expected size without a GGML header', () => {
    const root = modelRootFor(tempDirectory());
    mkdirSync(root, { recursive: true });
    const tiny = modelPath(root, 'tiny');
    if (!tiny) {
      throw new Error('missing model path');
    }
    writeFileSync(tiny, '');
    truncateSync(tiny, 77_691_713);

    const models = installedModels(root);
    expect(models.find((model) => model.id === 'tiny')?.installed).toBe(false);
  });

  it('downloads a model response to the model root', async () => {
    const root = tempDirectory();
    const progress: number[] = [];
    const body = Buffer.concat([GGML_HEADER, Buffer.from([1, 2, 3, 4])]);
    const destination = await downloadModel({
      root,
      modelId: 'tiny',
      fetchImpl: async () => new Response(body, { status: 200 }),
      expectedSha256: fixtureChecksum(body),
      onProgress: (value) => progress.push(value),
    });

    expect(destination).toBe(join(root, 'ggml-tiny.bin'));
    expect(statSync(destination).size).toBe(body.length);
    expect(progress.at(-1)).toBe(1);
    expect(await sha256File(destination)).toBe(fixtureChecksum(body));
  });

  it('removes a download that fails its checksum', async () => {
    const root = tempDirectory();
    const body = Buffer.concat([GGML_HEADER, Buffer.from([1, 2, 3, 4])]);

    await expect(
      downloadModel({
        root,
        modelId: 'tiny',
        fetchImpl: async () => new Response(body, { status: 200 }),
        expectedSha256: 'deadbeef',
      }),
    ).rejects.toThrow(/checksum did not match/);

    expect(existsSync(join(root, 'ggml-tiny.bin'))).toBe(false);
    expect(existsSync(join(root, 'ggml-tiny.bin.part'))).toBe(false);
  });

  it('re-downloads a corrupt installed model instead of reusing it', async () => {
    const root = tempDirectory();
    const corrupt = join(root, 'ggml-tiny.bin');
    writeFileSync(corrupt, '');
    truncateSync(corrupt, 77_691_713);

    const body = Buffer.concat([GGML_HEADER, Buffer.from([9])]);
    const destination = await downloadModel({
      root,
      modelId: 'tiny',
      fetchImpl: async () => new Response(body, { status: 200 }),
      expectedSha256: fixtureChecksum(body),
    });

    expect(destination).toBe(corrupt);
    expect(await sha256File(destination)).toBe(fixtureChecksum(body));
  });
});
