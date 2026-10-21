import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findMediaTools, probeMedia, runProcess } from './ffmpeg';
import type { MediaToolPaths } from './ffmpeg';
import {
  assetCachePaths,
  buildProxyArgs,
  buildThumbnailArgs,
  buildWaveformArgs,
  generateProxy,
  generateThumbnail,
  generateWaveform,
} from './generate';

const tempDirectories: string[] = [];

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kerf-generate-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

let tools: MediaToolPaths | null = null;
try {
  tools = findMediaTools();
} catch {
  tools = null;
}

describe('media command builders', () => {
  it('builds a 720p faststart proxy with optional audio', () => {
    const withAudio = buildProxyArgs('/in.mov', '/out.mp4', {
      hasAudio: true,
    });
    expect(withAudio).toContain('libx264');
    expect(withAudio).toContain('+faststart');
    expect(withAudio).toContain('0:a:0?');
    expect(withAudio).toContain("scale=-2:'min(720,ih)'");

    const silent = buildProxyArgs('/in.mov', '/out.mp4', {
      hasAudio: false,
    });
    expect(silent).toContain('-an');
    expect(silent).not.toContain('0:a:0?');
  });

  it('seeks before the input for video thumbnails', () => {
    expect(buildThumbnailArgs('/in.mp4', '/out.jpg', { atSeconds: 2 })).toEqual(
      [
        '-y',
        '-ss',
        '2',
        '-i',
        '/in.mp4',
        '-frames:v',
        '1',
        '-vf',
        'scale=480:-2',
        '-q:v',
        '4',
        '/out.jpg',
      ],
    );
    expect(
      buildThumbnailArgs('/in.png', '/out.jpg', { isImage: true }),
    ).not.toContain('-ss');
  });

  it('builds the brass waveform filter', () => {
    expect(buildWaveformArgs('/in.mp4', '/out.png')).toContain(
      'aformat=channel_layouts=mono,showwavespic=s=1200x160:colors=#c9a46a',
    );
  });

  it('places cache files in the project cache folders', () => {
    expect(assetCachePaths('/projects/demo', 'ast_1')).toEqual({
      proxyPath: '/projects/demo/cache/proxies/ast_1.mp4',
      thumbnailPath: '/projects/demo/cache/thumbnails/ast_1.jpg',
      waveformPath: '/projects/demo/cache/waveforms/ast_1.png',
      filmstripPath: null,
    });
  });
});

const integration = tools ? it : it.skip;

describe('generate media integration', () => {
  integration(
    'generates a proxy, thumbnail and waveform from a fixture',
    async () => {
      const directory = makeTempDirectory();
      const fixture = join(directory, 'fixture.mp4');
      const proxy = join(directory, 'cache', 'proxy.mp4');
      const thumbnail = join(directory, 'cache', 'thumb.jpg');
      const waveform = join(directory, 'cache', 'waveform.png');

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
        fixture,
      ]);

      const progress: number[] = [];
      await generateProxy(fixture, proxy, {
        ffmpegPath: tools!.ffmpeg,
        durationSeconds: 0.8,
        hasAudio: true,
        onProgress: (value) => progress.push(value),
      });
      await generateThumbnail(fixture, thumbnail, {
        ffmpegPath: tools!.ffmpeg,
        atSeconds: 0.1,
      });
      await generateWaveform(fixture, waveform, {
        ffmpegPath: tools!.ffmpeg,
      });

      expect(statSync(proxy).size).toBeGreaterThan(0);
      expect(statSync(thumbnail).size).toBeGreaterThan(0);
      expect(statSync(waveform).size).toBeGreaterThan(0);
      expect(progress.at(-1)).toBe(1);

      const probe = await probeMedia(proxy, {
        ffprobePath: tools!.ffprobe,
      });
      expect(probe.width).toBe(640);
      expect(probe.height).toBe(360);
      expect(probe.hasAudio).toBe(true);
    },
  );
});
