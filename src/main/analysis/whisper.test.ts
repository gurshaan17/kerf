import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
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
} from './whisper';

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
    writeFileSync(tiny, '');
    truncateSync(tiny, 77_691_713);

    const models = installedModels(root);
    expect(models.find((model) => model.id === 'tiny')?.installed).toBe(true);
    expect(statSync(tiny).size).toBe(77_691_713);
    expect(deleteModel(root, 'tiny')).toBe(true);
    expect(deleteModel(root, 'tiny')).toBe(false);
  });

  it('downloads a model response to the model root', async () => {
    const root = tempDirectory();
    const progress: number[] = [];
    const destination = await downloadModel({
      root,
      modelId: 'tiny',
      fetchImpl: async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
      onProgress: (value) => progress.push(value),
    });

    expect(destination).toBe(join(root, 'ggml-tiny.bin'));
    expect(statSync(destination).size).toBe(4);
    expect(progress.at(-1)).toBe(1);
  });
});
