import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { FrameRate, MediaStream } from '@kerf/model';

export interface MediaToolPaths {
  readonly ffmpeg: string;
  readonly ffprobe: string;
}

export interface FindMediaToolsOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly pathEnv?: string;
  readonly useFallbackDirectories?: boolean;
}

export type MediaToolName = 'ffmpeg' | 'ffprobe';

const TOOL_ENV: Readonly<Record<MediaToolName, string>> = {
  ffmpeg: 'KERF_FFMPEG_PATH',
  ffprobe: 'KERF_FFPROBE_PATH',
};

const FALLBACK_DIRECTORIES = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/local/bin',
  '/usr/bin',
  'C:\\ffmpeg\\bin',
];

export class MediaToolError extends Error {
  readonly code: 'tool-not-found';

  constructor(message: string) {
    super(message);
    this.name = 'MediaToolError';
    this.code = 'tool-not-found';
  }
}

export class MediaProcessError extends Error {
  readonly code: 'process-failed' | 'cancelled';
  readonly stderr: string;

  constructor(
    message: string,
    code: 'process-failed' | 'cancelled',
    stderr = '',
  ) {
    super(message);
    this.name = 'MediaProcessError';
    this.code = code;
    this.stderr = stderr;
  }
}

function executableExtensions(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
}

function isExecutable(filePath: string): boolean {
  try {
    if (!statSync(filePath).isFile()) {
      return false;
    }
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function searchDirectory(
  directory: string,
  name: string,
  platform: NodeJS.Platform,
): string | null {
  for (const suffix of executableExtensions(platform)) {
    const candidate = join(directory, `${name}${suffix}`);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function findExecutable(
  name: MediaToolName,
  options: FindMediaToolsOptions = {},
): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const configured = env[TOOL_ENV[name]]?.trim();

  if (configured) {
    const candidate = isAbsolute(configured) ? configured : resolve(configured);
    if (isExecutable(candidate)) {
      return candidate;
    }
    throw new MediaToolError(
      `${TOOL_ENV[name]} points to a file that is not executable: ${configured}`,
    );
  }

  const pathEnv = options.pathEnv ?? env.PATH ?? '';
  const directories = [
    ...pathEnv.split(delimiter),
    ...(options.useFallbackDirectories === false ? [] : FALLBACK_DIRECTORIES),
  ].filter((directory) => directory.trim().length > 0);

  for (const directory of directories) {
    const found = searchDirectory(directory, name, platform);
    if (found) {
      return found;
    }
  }

  throw new MediaToolError(
    `Could not find ${name}. Install FFmpeg or set ${TOOL_ENV[name]}.`,
  );
}

export function findMediaTools(
  options: FindMediaToolsOptions = {},
): MediaToolPaths {
  return {
    ffmpeg: findExecutable('ffmpeg', options),
    ffprobe: findExecutable('ffprobe', options),
  };
}

export interface RunProcessOptions {
  readonly signal?: AbortSignal;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly onStdoutLine?: (line: string) => void;
  readonly onStderrLine?: (line: string) => void;
  readonly captureLimit?: number;
}

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function appendLimited(current: string, chunk: string, limit: number): string {
  if (limit <= 0) {
    return '';
  }
  const next = current + chunk;
  return next.length > limit ? next.slice(-limit) : next;
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  if (options.signal?.aborted) {
    return Promise.reject(
      new MediaProcessError('The process was cancelled.', 'cancelled'),
    );
  }

  const captureLimit = options.captureLimit ?? 256 * 1024;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdout = '';
    let stderr = '';
    let stdoutLine = '';
    let stderrLine = '';

    const collect = (
      decoder: StringDecoder,
      chunk: Buffer,
      transform: (line: string) => void,
      currentLine: string,
      stream: 'stdout' | 'stderr',
    ): string => {
      const text = decoder.write(chunk);
      if (stream === 'stdout') {
        stdout = appendLimited(stdout, text, captureLimit);
      } else {
        stderr = appendLimited(stderr, text, captureLimit);
      }
      let next = currentLine + text;
      const lines = next.split(/\r?\n/);
      next = lines.pop() ?? '';
      for (const line of lines) {
        transform(line);
      }
      return next;
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutLine = collect(
        stdoutDecoder,
        chunk,
        (line) => options.onStdoutLine?.(line),
        stdoutLine,
        'stdout',
      );
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrLine = collect(
        stderrDecoder,
        chunk,
        (line) => options.onStderrLine?.(line),
        stderrLine,
        'stderr',
      );
    });

    child.once('error', (error: NodeJS.ErrnoException) => {
      if (options.signal?.aborted || error.name === 'AbortError') {
        reject(
          new MediaProcessError('The process was cancelled.', 'cancelled'),
        );
        return;
      }
      reject(
        new MediaProcessError(
          `Could not start ${command}: ${error.message}`,
          'process-failed',
          stderr,
        ),
      );
    });

    child.once('close', (code, signal) => {
      const remainingStdout = stdoutDecoder.end();
      const remainingStderr = stderrDecoder.end();
      stdout = appendLimited(stdout, remainingStdout, captureLimit);
      stderr = appendLimited(stderr, remainingStderr, captureLimit);
      const finalStdoutLine = stdoutLine + remainingStdout;
      const finalStderrLine = stderrLine + remainingStderr;
      if (finalStdoutLine.length > 0) {
        options.onStdoutLine?.(finalStdoutLine);
      }
      if (finalStderrLine.length > 0) {
        options.onStderrLine?.(finalStderrLine);
      }

      if (options.signal?.aborted) {
        reject(
          new MediaProcessError('The process was cancelled.', 'cancelled'),
        );
        return;
      }
      if (signal) {
        reject(
          new MediaProcessError(
            `${command} stopped with signal ${signal}.`,
            'process-failed',
            stderr,
          ),
        );
        return;
      }
      const exitCode = code ?? -1;
      if (exitCode !== 0) {
        reject(
          new MediaProcessError(
            `${command} exited with code ${exitCode}.`,
            'process-failed',
            stderr,
          ),
        );
        return;
      }
      resolvePromise({ stdout, stderr, code: exitCode });
    });
  });
}

export interface RunFfmpegOptions {
  readonly signal?: AbortSignal;
  readonly durationSeconds?: number;
  readonly onProgress?: (progress: number) => void;
  readonly cwd?: string;
  readonly captureLimit?: number;
}

function progressFromLine(
  line: string,
  durationSeconds: number | undefined,
): number | null {
  const match = /^(?:out_time_us|out_time_ms)=(\d+)$/.exec(line.trim());
  if (!match) {
    return null;
  }
  const seconds = Number(match[1]) / 1_000_000;
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  if (!durationSeconds || durationSeconds <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, seconds / durationSeconds));
}

export async function runFfmpeg(
  ffmpegPath: string,
  args: readonly string[],
  options: RunFfmpegOptions = {},
): Promise<ProcessResult> {
  let lastProgress = -1;
  const emitProgress = (value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    if (clamped <= lastProgress) {
      return;
    }
    lastProgress = clamped;
    options.onProgress?.(clamped);
  };

  return runProcess(
    ffmpegPath,
    ['-hide_banner', '-nostdin', '-progress', 'pipe:2', ...args],
    {
      signal: options.signal,
      cwd: options.cwd,
      captureLimit: options.captureLimit,
      onStderrLine: (line) => {
        if (line.trim() === 'progress=end') {
          emitProgress(1);
          return;
        }
        const progress = progressFromLine(line, options.durationSeconds);
        if (progress !== null) {
          emitProgress(progress);
        }
      },
    },
  );
}

export interface MediaProbe {
  readonly durationSeconds: number;
  readonly formatName: string | null;
  readonly streams: MediaStream[];
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  readonly width: number | null;
  readonly height: number | null;
  readonly frameRate: FrameRate | null;
}

interface RawStream {
  readonly index?: unknown;
  readonly codec_type?: unknown;
  readonly codec_name?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly avg_frame_rate?: unknown;
  readonly r_frame_rate?: unknown;
  readonly sample_rate?: unknown;
  readonly channels?: unknown;
  readonly duration?: unknown;
}

interface RawProbe {
  readonly streams?: unknown;
  readonly format?: unknown;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = numeric(value);
  return parsed !== null && parsed > 0 && Number.isInteger(parsed)
    ? parsed
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseRate(value: unknown): FrameRate | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (
    !Number.isInteger(numerator) ||
    !Number.isInteger(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    return null;
  }
  const fps = numerator / denominator;
  if (fps < 1 || fps > 240) {
    return null;
  }
  return { numerator, denominator };
}

function streamKind(value: unknown): MediaStream['kind'] | null {
  switch (value) {
    case 'video':
    case 'audio':
    case 'subtitle':
    case 'data':
      return value;
    default:
      return null;
  }
}

function parseStream(
  raw: RawStream,
  fallbackIndex: number,
): MediaStream | null {
  const kind = streamKind(raw.codec_type);
  if (!kind) {
    return null;
  }
  const duration = numeric(raw.duration);
  return {
    index: positiveInteger(raw.index) ?? fallbackIndex,
    kind,
    codec: text(raw.codec_name),
    width: positiveInteger(raw.width),
    height: positiveInteger(raw.height),
    frameRate: parseRate(raw.avg_frame_rate) ?? parseRate(raw.r_frame_rate),
    sampleRate: positiveInteger(raw.sample_rate),
    channels: positiveInteger(raw.channels),
    durationSeconds: duration !== null && duration >= 0 ? duration : null,
  };
}

export function parseFfprobeOutput(output: string): MediaProbe {
  let raw: RawProbe;
  try {
    raw = JSON.parse(output) as RawProbe;
  } catch {
    throw new MediaProcessError(
      'FFprobe returned invalid JSON.',
      'process-failed',
    );
  }

  const rawStreams = Array.isArray(raw.streams) ? raw.streams : [];
  const streams = rawStreams
    .map((entry, index) =>
      entry && typeof entry === 'object'
        ? parseStream(entry as RawStream, index)
        : null,
    )
    .filter((entry): entry is MediaStream => entry !== null);

  const format =
    raw.format && typeof raw.format === 'object'
      ? (raw.format as {
          readonly duration?: unknown;
          readonly format_name?: unknown;
        })
      : null;
  const formatDuration = numeric(format?.duration);
  const streamDuration = streams.reduce(
    (longest, stream) => Math.max(longest, stream.durationSeconds ?? 0),
    0,
  );
  const durationSeconds = Math.max(formatDuration ?? 0, streamDuration);

  const video = streams.find((stream) => stream.kind === 'video') ?? null;
  const audio = streams.find((stream) => stream.kind === 'audio') ?? null;

  return {
    durationSeconds,
    formatName: text(format?.format_name),
    streams,
    hasVideo: video !== null,
    hasAudio: audio !== null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    frameRate: video?.frameRate ?? null,
  };
}

export interface ProbeMediaOptions {
  readonly signal?: AbortSignal;
  readonly ffprobePath?: string;
}

export async function probeMedia(
  filePath: string,
  options: ProbeMediaOptions = {},
): Promise<MediaProbe> {
  const ffprobePath = options.ffprobePath ?? findExecutable('ffprobe');
  const result = await runProcess(
    ffprobePath,
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    { signal: options.signal },
  );
  return parseFfprobeOutput(result.stdout);
}
