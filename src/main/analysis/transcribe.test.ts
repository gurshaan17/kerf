import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assetSchema, createAsset, createProject } from '@kerf/model';
import { transcribeAsset, transcriptFromWhisper } from './transcribe';

const directories: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kerf-transcribe-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeAsset(sourcePath: string) {
  const project = createProject({ name: 'Transcribe', now: 1 });
  return assetSchema.parse({
    ...createAsset({
      projectId: project.id,
      name: 'take.mp4',
      kind: 'video',
      sourcePath,
      now: 2,
    }),
    status: 'ready',
    hasAudio: true,
    hasVideo: true,
    durationSeconds: 2,
    frameRate: { numerator: 24, denominator: 1 },
  });
}

describe('transcriptFromWhisper', () => {
  it('turns whisper timestamps into frame-accurate words and segments', () => {
    const transcript = transcriptFromWhisper(
      {
        params: { language: 'en' },
        transcription: [
          {
            timestamps: { from_ms: 500, to_ms: 1500 },
            text: ' Hello Kerf world',
          },
        ],
      },
      makeAsset('/tmp/missing.mp4'),
      { numerator: 24, denominator: 1 },
      'ggml-tiny.bin',
      10,
    );

    expect(transcript.createdAt).toBe(10);
    expect(transcript.language).toBe('en');
    expect(transcript.segments).toHaveLength(1);
    expect(transcript.segments[0]?.startFrame).toBe(12);
    expect(transcript.segments[0]?.endFrame).toBe(36);
    expect(transcript.segments[0]?.words.map((word) => word.text)).toEqual([
      'Hello',
      'Kerf',
      'world',
    ]);
  });

  it('accepts segment-style whisper JSON', () => {
    const transcript = transcriptFromWhisper(
      {
        segments: [{ start: 0, end: 1, text: 'One two' }],
      },
      makeAsset('/tmp/missing.mp4'),
      { numerator: 10, denominator: 1 },
      'model',
      1,
    );
    expect(transcript.text).toBe('One two');
    expect(transcript.segments[0]?.words).toHaveLength(2);
    expect(transcript.segments[0]?.endFrame).toBe(10);
  });

  it('runs a whisper-compatible CLI without a model download', async () => {
    const directory = tempDirectory();
    const ffmpeg = join(directory, 'ffmpeg');
    writeFileSync(
      ffmpeg,
      '#!/bin/sh\nfor last; do :; done\nprintf "fake wav" > "$last"\n',
    );
    chmodSync(ffmpeg, 0o755);
    const whisper = join(directory, 'whisper');
    writeFileSync(
      whisper,
      [
        '#!/bin/sh',
        'out=""',
        'prev=""',
        'for arg in "$@"; do',
        '  if [ "$prev" = "-of" ]; then out="$arg"; fi',
        '  prev="$arg"',
        'done',
        'cat > "$out.json" <<JSON',
        '{"params":{"language":"en"},"transcription":[{"timestamps":{"from_ms":0,"to_ms":1000},"text":"hello editor"}]}',
        'JSON',
      ].join('\n'),
    );
    chmodSync(whisper, 0o755);
    const source = join(directory, 'take.mp4');
    writeFileSync(source, 'not real media');
    const asset = makeAsset(source);
    const workDirectory = join(directory, 'work');
    const progress: number[] = [];

    const transcript = await transcribeAsset({
      asset,
      ffmpeg,
      whisper,
      model: join(directory, 'ggml-tiny.bin'),
      workDirectory,
      onProgress: (value) => progress.push(value),
    });

    expect(transcript.assetId).toBe(asset.id);
    expect(transcript.segments[0]?.text).toBe('hello editor');
    expect(progress.at(-1)).toBe(0.98);
    expect(existsSync(workDirectory)).toBe(true);
  }, 15_000);
});
