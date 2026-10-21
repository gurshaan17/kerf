import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MediaProcessError,
  MediaToolError,
  findExecutable,
  findMediaTools,
  parseFfprobeOutput,
  probeMedia,
  runProcess,
} from './ffmpeg';
import type { MediaToolPaths } from './ffmpeg';

const tempDirectories: string[] = [];

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kerf-media-tools-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const SAMPLE_PROBE = JSON.stringify({
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      avg_frame_rate: '24000/1001',
      duration: '12.512',
    },
    {
      index: 1,
      codec_type: 'audio',
      codec_name: 'aac',
      sample_rate: '48000',
      channels: 2,
      duration: '12.5',
    },
  ],
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '12.512',
  },
});

describe('media tool discovery', () => {
  it('finds an executable on the configured PATH', () => {
    const directory = makeTempDirectory();
    const executable = join(directory, 'ffmpeg');
    writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    chmodSync(executable, 0o755);

    expect(
      findExecutable('ffmpeg', {
        pathEnv: directory,
        useFallbackDirectories: false,
      }),
    ).toBe(executable);
  });

  it('honours explicit tool paths and validates them', () => {
    const tools = findMediaTools({
      env: {
        KERF_FFMPEG_PATH: process.execPath,
        KERF_FFPROBE_PATH: process.execPath,
      },
    });
    expect(tools.ffmpeg).toBe(process.execPath);
    expect(tools.ffprobe).toBe(process.execPath);

    expect(() =>
      findExecutable('ffmpeg', {
        env: { KERF_FFMPEG_PATH: '/definitely/missing/ffmpeg' },
      }),
    ).toThrow(MediaToolError);
  });

  it('reports a missing tool with an actionable message', () => {
    const directory = makeTempDirectory();
    expect(() =>
      findExecutable('ffprobe', {
        pathEnv: directory,
        useFallbackDirectories: false,
      }),
    ).toThrow(/set KERF_FFPROBE_PATH/);
  });
});

describe('parseFfprobeOutput', () => {
  it('maps video and audio streams into the media model', () => {
    const probe = parseFfprobeOutput(SAMPLE_PROBE);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    expect(probe.width).toBe(1920);
    expect(probe.height).toBe(1080);
    expect(probe.frameRate).toEqual({ numerator: 24000, denominator: 1001 });
    expect(probe.durationSeconds).toBe(12.512);
    expect(probe.streams).toHaveLength(2);
    expect(probe.streams[1]).toMatchObject({
      kind: 'audio',
      codec: 'aac',
      sampleRate: 48000,
      channels: 2,
    });
  });

  it('rejects malformed output', () => {
    expect(() => parseFfprobeOutput('not json')).toThrow(MediaProcessError);
  });
});

describe('runProcess', () => {
  it('captures streams and line output', async () => {
    const lines: string[] = [];
    const result = await runProcess(
      process.execPath,
      [
        '-e',
        "process.stdout.write('one\\ntwo\\n'); process.stderr.write('warn\\n');",
      ],
      { onStdoutLine: (line) => lines.push(line) },
    );

    expect(result.stdout).toBe('one\ntwo\n');
    expect(result.stderr).toBe('warn\n');
    expect(lines).toEqual(['one', 'two']);
  });

  it('rejects when the process is aborted', async () => {
    const controller = new AbortController();
    const pending = runProcess(
      process.execPath,
      ['-e', 'setTimeout(() => process.exit(0), 2_000)'],
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
});

let tools: MediaToolPaths | null = null;
try {
  tools = findMediaTools();
} catch {
  tools = null;
}

const integration = tools ? it : it.skip;

describe('probeMedia integration', () => {
  integration('probes a generated video fixture', async () => {
    const directory = makeTempDirectory();
    const fixture = join(directory, 'fixture.mp4');
    await runProcess(tools!.ffmpeg, [
      '-hide_banner',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=24',
      '-t',
      '0.4',
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'mpeg4',
      fixture,
    ]);

    const probe = await probeMedia(fixture, {
      ffprobePath: tools!.ffprobe,
    });
    expect(probe.hasVideo).toBe(true);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
    expect(probe.durationSeconds).toBeGreaterThan(0.3);
  });
});
