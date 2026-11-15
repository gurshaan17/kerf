import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';

export const repoRoot = resolve(process.cwd());
export const cacheRoot = join(repoRoot, '.cache', 'e2e');
export const whisperModelUrl =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';
export const whisperModelBytes = 77_691_713;

export interface LaunchedKerf {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly userData: string;
  readonly projectsRoot: string;
  readonly workspace: string;
  close(): Promise<void>;
}

function executable(name: string): string {
  const path = execFileSync('which', [name], { encoding: 'utf8' }).trim();
  if (!path) {
    throw new Error(`Could not find ${name} on PATH.`);
  }
  return path;
}

export function ensureWhisperModel(): string {
  mkdirSync(cacheRoot, { recursive: true });
  const destination = join(cacheRoot, 'ggml-tiny.bin');
  if (
    existsSync(destination) &&
    statSync(destination).size >= whisperModelBytes * 0.9
  ) {
    return destination;
  }
  const partial = `${destination}.part`;
  rmSync(partial, { force: true });
  execFileSync(
    'curl',
    ['-L', '--fail', '--retry', '3', '-o', partial, whisperModelUrl],
    { stdio: 'inherit' },
  );
  renameSync(partial, destination);
  return destination;
}

function usableCaptionFixture(video: string, ffprobe: string): boolean {
  if (!existsSync(video) || statSync(video).size <= 1_000) return false;
  try {
    const metadata = JSON.parse(
      execFileSync(
        ffprobe,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=codec_type,nb_frames,duration,width,height',
          '-of',
          'json',
          video,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    ) as {
      format?: { duration?: string };
      streams?: {
        codec_type?: string;
        nb_frames?: string;
        duration?: string;
        width?: number;
        height?: number;
      }[];
    };
    return (
      Number(metadata.format?.duration) > 2 &&
      Boolean(
        metadata.streams?.some(
          (stream) =>
            stream.codec_type === 'video' &&
            Number(stream.nb_frames) > 0 &&
            Number(stream.width) > 0 &&
            Number(stream.height) > 0,
        ),
      ) &&
      Boolean(
        metadata.streams?.some(
          (stream) =>
            stream.codec_type === 'audio' && Number(stream.duration) > 2,
        ),
      )
    );
  } catch {
    return false;
  }
}

export function ensureCaptionFixture(directory = cacheRoot): string {
  mkdirSync(directory, { recursive: true });
  const video = join(directory, 'caption-source.mp4');
  const ffprobe = executable('ffprobe');
  if (usableCaptionFixture(video, ffprobe)) return video;
  // Hosted macOS can return success from `say` with only 10 ms of audio.
  // Keep real speech checked in so CI never depends on installed system voices.
  const speech = join(repoRoot, 'test', 'fixtures', 'caption-speech.wav');
  const ffmpeg = executable('ffmpeg');
  execFileSync(
    ffmpeg,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x24272d:s=640x360:r=24:d=8',
      '-i',
      speech,
      '-shortest',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      video,
    ],
    { stdio: 'inherit' },
  );
  if (!usableCaptionFixture(video, ffprobe))
    throw new Error(
      'Caption fixture generation did not produce usable video frames and speech audio.',
    );
  return video;
}

/**
 * A 120 BPM click track with enough bars for two coarse sections. The short
 * 1 kHz burst every half second gives the local onset detector a clean grid.
 */
export function ensureBeatsFixture(): string {
  mkdirSync(cacheRoot, { recursive: true });
  const audio = join(cacheRoot, 'beats-source.wav');
  if (existsSync(audio) && statSync(audio).size > 1_000) {
    return audio;
  }
  const ffmpeg = executable('ffmpeg');
  execFileSync(
    ffmpeg,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=if(lt(mod(t\\,0.5)\\,0.02)\\,0.9*sin(2*PI*1000*t)\\,0):s=44100:d=30',
      '-c:a',
      'pcm_s16le',
      audio,
    ],
    { stdio: 'inherit' },
  );
  return audio;
}

export function ensureScenesFixture(): string {
  mkdirSync(cacheRoot, { recursive: true });
  const video = join(cacheRoot, 'scenes-source.mp4');
  if (existsSync(video) && statSync(video).size > 1_000) {
    return video;
  }
  const ffmpeg = executable('ffmpeg');
  execFileSync(
    ffmpeg,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0xff0000:s=640x360:r=24:d=2',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x00ff00:s=640x360:r=24:d=2',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x0000ff:s=640x360:r=24:d=2',
      '-filter_complex',
      '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      video,
    ],
    { stdio: 'inherit' },
  );
  return video;
}

export function probeDurationSeconds(path: string): number {
  const ffprobe = executable('ffprobe');
  const value = execFileSync(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ],
    { encoding: 'utf8' },
  ).trim();
  return Number(value);
}

export async function launchKerf(
  options: { whisper?: boolean } = {},
): Promise<LaunchedKerf> {
  const workspace = mkdtempSync(join(tmpdir(), 'kerf-e2e-'));
  const userData = join(workspace, 'user-data');
  const projectsRoot = join(workspace, 'projects');
  const modelDirectory = join(userData, 'models', 'whisper');
  mkdirSync(modelDirectory, { recursive: true });
  mkdirSync(projectsRoot, { recursive: true });
  if (options.whisper !== false)
    symlinkSync(ensureWhisperModel(), join(modelDirectory, 'ggml-tiny.bin'));

  const app = await electron.launch({
    args: [repoRoot],
    env: {
      ...process.env,
      KERF_E2E: '1',
      KERF_USER_DATA: userData,
      KERF_DATABASE_PATH: join(workspace, 'kerf.db'),
      KERF_PROJECTS_ROOT: projectsRoot,
      ...(options.whisper === false
        ? {}
        : { KERF_WHISPER_PATH: executable('whisper-cli') }),
      KERF_FFMPEG_PATH: executable('ffmpeg'),
      KERF_FFPROBE_PATH: executable('ffprobe'),
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return {
    app,
    page,
    userData,
    projectsRoot,
    workspace,
    async close() {
      await app.close().catch(() => undefined);
      rmSync(workspace, { recursive: true, force: true });
    },
  };
}
