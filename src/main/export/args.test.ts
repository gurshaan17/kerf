import { describe, expect, it } from 'vitest';
import { buildExportArgs } from './args';
import type { ExportAudioClip } from './audio-plan';

const base = {
  framePattern: '/tmp/frames/frame_%05d.png',
  frameRate: 24,
  frameCount: 240,
  durationSeconds: 10,
  width: 1920,
  height: 1080,
  outputPath: '/tmp/out.mp4',
  audioClips: [] as ExportAudioClip[],
};

describe('export ffmpeg arguments', () => {
  it('encodes the image sequence without an audio stream when silent', () => {
    const args = buildExportArgs(base);
    expect(args).toContain('/tmp/frames/frame_%05d.png');
    expect(args.join(' ')).toContain('-frames:v 240');
    expect(args).toContain('-an');
    expect(args.at(-1)).toBe('/tmp/out.mp4');
  });

  it('builds a filter graph for multiple audio clips', () => {
    const args = buildExportArgs({
      ...base,
      audioClips: [
        {
          path: '/media/a.wav',
          sourceStartSeconds: 2,
          sourceDurationSeconds: 4,
          delaySeconds: 0.5,
          timelineDurationSeconds: 2,
          speed: 2,
          reversed: false,
          volume: 0.8,
          fadeInSeconds: 0.25,
          fadeOutSeconds: 0,
        },
        {
          path: '/media/b.wav',
          sourceStartSeconds: 0,
          sourceDurationSeconds: 2,
          delaySeconds: 0,
          timelineDurationSeconds: 2,
          speed: 1,
          reversed: true,
          volume: 1,
          fadeInSeconds: 0,
          fadeOutSeconds: 0.5,
        },
      ],
    });
    const joined = args.join(' ');
    expect(joined).toContain('-ss 2.000000 -t 4.000000 -i /media/a.wav');
    expect(joined).toContain('atempo=2.000000');
    expect(joined).toContain('areverse');
    expect(joined).toContain('adelay=500|500');
    expect(joined).toContain('amix=inputs=2');
    expect(joined).toContain('-c:a aac -b:a 192k -ar 48000');
    expect(joined).not.toContain('-an');
  });

  it('chains atempo filters beyond the two-times limit', () => {
    const args = buildExportArgs({
      ...base,
      audioClips: [
        {
          path: '/media/fast.wav',
          sourceStartSeconds: 0,
          sourceDurationSeconds: 8,
          delaySeconds: 0,
          timelineDurationSeconds: 1,
          speed: 8,
          reversed: false,
          volume: 1,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
        },
      ],
    });
    const filter = args[args.indexOf('-filter_complex') + 1] ?? '';
    expect(filter).toContain('atempo=2,atempo=2,atempo=2.000000');
  });
});
