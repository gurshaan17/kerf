import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { WhisperModelInfo } from '../../shared/contracts';

export const WHISPER_MODELS: ReadonlyArray<
  Omit<WhisperModelInfo, 'installed' | 'downloadedBytes'>
> = [
  {
    id: 'tiny',
    name: 'Tiny',
    fileName: 'ggml-tiny.bin',
    sizeBytes: 77_691_713,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  },
  {
    id: 'base',
    name: 'Base',
    fileName: 'ggml-base.bin',
    sizeBytes: 147_951_465,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  },
  {
    id: 'small',
    name: 'Small',
    fileName: 'ggml-small.bin',
    sizeBytes: 487_601_967,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
  },
];

/** SHA-256 published by the whisper.cpp model repository for each download. */
const MODEL_CHECKSUMS: Readonly<Record<string, string>> = {
  tiny: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
  base: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
  small: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
};

/** Every whisper.cpp model starts with the GGML magic, stored little-endian. */
const GGML_MAGIC = 0x67676d6c;

const WHISPER_NAMES = ['whisper-cli', 'whisper-cpp', 'whisper'];
const FALLBACK_DIRECTORIES = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/local/bin',
  '/usr/bin',
];

export class WhisperUnavailableError extends Error {
  readonly code = 'whisper-unavailable' as const;

  constructor(message: string) {
    super(message);
    this.name = 'WhisperUnavailableError';
  }
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

export interface FindWhisperOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly pathEnv?: string;
  readonly useFallbackDirectories?: boolean;
}

export function findWhisperBinary(
  options: FindWhisperOptions = {},
): string | null {
  const env = options.env ?? process.env;
  const configured = env.KERF_WHISPER_PATH?.trim();
  if (configured) {
    const candidate = isAbsolute(configured) ? configured : resolve(configured);
    if (!isExecutable(candidate)) {
      throw new WhisperUnavailableError(
        `KERF_WHISPER_PATH points to a file that is not executable: ${configured}`,
      );
    }
    return candidate;
  }

  const platform = options.platform ?? process.platform;
  const suffixes = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const pathEnv = options.pathEnv ?? env.PATH ?? '';
  const directories = [
    ...pathEnv.split(delimiter),
    ...(options.useFallbackDirectories === false ? [] : FALLBACK_DIRECTORIES),
  ].filter((directory) => directory.trim().length > 0);

  for (const directory of directories) {
    for (const name of WHISPER_NAMES) {
      for (const suffix of suffixes) {
        const candidate = join(directory, `${name}${suffix}`);
        if (isExecutable(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

export function modelRootFor(userData: string): string {
  return join(userData, 'models', 'whisper');
}

export function modelPath(root: string, modelId: string): string | null {
  const model = WHISPER_MODELS.find((candidate) => candidate.id === modelId);
  return model ? join(root, model.fileName) : null;
}

function hasGgmlMagic(path: string): boolean {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'r');
    const header = Buffer.alloc(4);
    return (
      readSync(descriptor, header, 0, header.length, 0) === header.length &&
      header.readUInt32LE(0) === GGML_MAGIC
    );
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

/**
 * A complete model is large enough and carries the GGML header. Size alone is
 * not enough: an interrupted or preallocated download can produce a file of the
 * exact expected length that whisper.cpp rejects as "invalid model data".
 */
function isModelFileUsable(
  path: string,
  model: Omit<WhisperModelInfo, 'installed' | 'downloadedBytes'>,
): boolean {
  return (
    existsSync(path) &&
    statSync(path).size >= model.sizeBytes * 0.9 &&
    hasGgmlMagic(path)
  );
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export function installedModels(root: string): WhisperModelInfo[] {
  return WHISPER_MODELS.map((model) => {
    const path = join(root, model.fileName);
    const size = existsSync(path) ? statSync(path).size : 0;
    return {
      id: model.id,
      name: model.name,
      fileName: model.fileName,
      sizeBytes: model.sizeBytes,
      url: model.url,
      installed: isModelFileUsable(path, model),
      downloadedBytes: size,
    };
  });
}

export function findModelPath(root: string): string | null {
  for (const model of installedModels(root)) {
    if (model.installed) {
      return join(root, model.fileName);
    }
  }
  return null;
}

export function resolveWhisper(root: string): {
  readonly binary: string | null;
  readonly model: string | null;
} {
  return {
    binary: findWhisperBinary(),
    model: findModelPath(root),
  };
}

export function deleteModel(root: string, modelId: string): boolean {
  const path = modelPath(root, modelId);
  if (!path || !existsSync(path)) {
    return false;
  }
  rmSync(path, { force: true });
  rmSync(`${path}.part`, { force: true });
  return true;
}

export interface DownloadModelOptions {
  readonly root: string;
  readonly modelId: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number) => void;
  readonly fetchImpl?: typeof fetch;
  /** Overrides the manifest checksum, for tests and local mirrors. */
  readonly expectedSha256?: string;
}

export async function downloadModel(
  options: DownloadModelOptions,
): Promise<string> {
  const model = WHISPER_MODELS.find(
    (candidate) => candidate.id === options.modelId,
  );
  if (!model) {
    throw new Error(`Unknown whisper model: ${options.modelId}`);
  }
  mkdirSync(options.root, { recursive: true });
  const destination = join(options.root, model.fileName);
  const partial = `${destination}.part`;
  const existing = existsSync(partial) ? statSync(partial).size : 0;

  if (existsSync(destination)) {
    if (isModelFileUsable(destination, model)) {
      options.onProgress?.(1);
      return destination;
    }
    rmSync(destination, { force: true });
  }

  const response = await (options.fetchImpl ?? fetch)(model.url, {
    signal: options.signal,
    headers: existing > 0 ? { Range: `bytes=${existing}-` } : undefined,
  });
  if (!response.ok) {
    throw new Error(
      `Could not download ${model.name}: HTTP ${response.status}.`,
    );
  }
  if (!response.body) {
    throw new Error(`Could not download ${model.name}: empty response.`);
  }

  const append = existing > 0 && response.status === 206;
  const start = append ? existing : 0;
  if (!append && existing > 0) {
    rmSync(partial, { force: true });
  }
  let received = start;
  const source = Readable.fromWeb(
    response.body as unknown as NodeReadableStream<Uint8Array>,
  );
  source.on('data', (chunk: Buffer) => {
    received += chunk.length;
    options.onProgress?.(
      Math.max(0, Math.min(0.99, received / model.sizeBytes)),
    );
  });
  await pipeline(
    source,
    createWriteStream(partial, { flags: append ? 'a' : 'w' }),
  );

  const expected = options.expectedSha256 ?? MODEL_CHECKSUMS[model.id];
  if (!hasGgmlMagic(partial)) {
    rmSync(partial, { force: true });
    throw new Error(
      `Could not download ${model.name}: the file is corrupt. Try again.`,
    );
  }
  if (!expected) {
    rmSync(partial, { force: true });
    throw new Error(`No checksum is configured for ${model.name}.`);
  }
  if ((await sha256File(partial)) !== expected) {
    rmSync(partial, { force: true });
    throw new Error(
      `Could not download ${model.name}: the checksum did not match. Try again.`,
    );
  }

  renameSync(partial, destination);
  options.onProgress?.(1);
  return destination;
}

export interface RunWhisperOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number) => void;
}

export function runWhisper(
  binary: string,
  args: readonly string[],
  options: RunWhisperOptions = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, [...args], {
      signal: options.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      const match = /progress\s*=\s*(\d+)%/i.exec(stderr);
      if (match) {
        options.onProgress?.(Math.min(0.99, Number(match[1]) / 100));
      }
    });
    child.once('error', (error) => {
      reject(new Error(`Could not start whisper: ${error.message}`));
    });
    child.once('close', (code) => {
      if (code === 0) {
        options.onProgress?.(1);
        resolvePromise(stdout);
      } else {
        reject(
          new Error(
            `whisper exited with code ${code ?? -1}: ${stderr.trim().slice(-600)}`,
          ),
        );
      }
    });
  });
}
