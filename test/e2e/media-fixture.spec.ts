import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { ensureCaptionFixture } from './helpers';

// Hosted macOS can report successful `say` synthesis while returning 10 ms of
// audio. Exercise the real fixture pipeline with that exact dependency behavior.
for (const cached of [false, true])
  test(`creates usable caption media without native speech (${cached ? 'corrupt cache' : 'fresh cache'})`, () => {
    const root = mkdtempSync(join(tmpdir(), 'kerf-caption-fixture-'));
    const previousPath = process.env.PATH;
    const previousSpeech = process.env.KERF_EMPTY_SPEECH;
    try {
      const emptySpeech = join(root, 'empty.aiff');
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=22050:cl=mono',
        '-t',
        '0.01',
        '-c:a',
        'pcm_s16be',
        emptySpeech,
      ]);
      const bin = join(root, 'bin');
      mkdirSync(bin);
      const say = join(bin, 'say');
      writeFileSync(say, '#!/bin/sh\n/bin/cp "$KERF_EMPTY_SPEECH" "$2"\n');
      chmodSync(say, 0o755);
      process.env.PATH = `${bin}${delimiter}${previousPath ?? ''}`;
      process.env.KERF_EMPTY_SPEECH = emptySpeech;
      const directory = join(root, 'media');
      if (cached) {
        mkdirSync(directory);
        writeFileSync(
          join(directory, 'caption-source.mp4'),
          Buffer.alloc(2048),
        );
      }
      const video = ensureCaptionFixture(directory);
      const metadata = JSON.parse(
        execFileSync(
          'ffprobe',
          [
            '-v',
            'error',
            '-show_streams',
            '-show_format',
            '-of',
            'json',
            video,
          ],
          { encoding: 'utf8' },
        ),
      );
      expect(
        metadata.streams.some(
          (stream: { codec_type: string; nb_frames?: string }) =>
            stream.codec_type === 'video' && Number(stream.nb_frames) > 0,
        ),
      ).toBe(true);
      expect(Number(metadata.format.duration)).toBeGreaterThan(2);
      expect(
        metadata.streams.some(
          (stream: { codec_type: string; duration?: string }) =>
            stream.codec_type === 'audio' && Number(stream.duration) > 2,
        ),
      ).toBe(true);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousSpeech === undefined) delete process.env.KERF_EMPTY_SPEECH;
      else process.env.KERF_EMPTY_SPEECH = previousSpeech;
      rmSync(root, { recursive: true, force: true });
    }
  });
