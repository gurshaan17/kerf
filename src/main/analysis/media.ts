import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { runFfmpeg, runProcess } from '../media/ffmpeg';

export interface SceneCut {
  readonly timeSeconds: number;
  readonly score: number;
}

export async function extractAudioWav(
  ffmpeg: string,
  sourcePath: string,
  destination: string,
  signal?: AbortSignal,
): Promise<string> {
  mkdirSync(dirname(destination), { recursive: true });
  try {
    await runFfmpeg(
      ffmpeg,
      [
        '-y',
        '-i',
        sourcePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        destination,
      ],
      { signal },
    );
    return destination;
  } catch (error) {
    rmSync(destination, { force: true });
    throw error;
  }
}

export async function decodePcm(
  ffmpeg: string,
  sourcePath: string,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const buffer = await new Promise<Buffer>((resolvePromise, reject) => {
    const child = spawn(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-v',
        'error',
        '-i',
        sourcePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-f',
        'f32le',
        '-',
      ],
      {
        signal,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      bytes += chunk.length;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4_000);
    });
    child.once('error', (error) => {
      reject(new Error(`Could not read audio: ${error.message}`));
    });
    child.once('close', (code) => {
      if (code === 0) {
        const buffer = Buffer.concat(chunks, bytes);
        resolvePromise(buffer);
      } else {
        reject(
          new Error(
            `ffmpeg could not decode audio (code ${code ?? -1}): ${stderr.trim()}`,
          ),
        );
      }
    });
  });
  const samples = new Float32Array(buffer.byteLength / 4);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readFloatLE(index * 4);
  }
  return samples;
}

export async function extractFrameAt(
  ffmpeg: string,
  sourcePath: string,
  timeSeconds: number,
  destination: string,
  signal?: AbortSignal,
): Promise<string> {
  mkdirSync(dirname(destination), { recursive: true });
  rmSync(destination, { force: true });
  await runFfmpeg(
    ffmpeg,
    [
      '-y',
      '-ss',
      Math.max(0, timeSeconds).toFixed(3),
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      '-vf',
      'scale=480:-2',
      '-q:v',
      '3',
      destination,
    ],
    { signal },
  );
  return destination;
}

export async function detectSceneCuts(
  ffmpeg: string,
  sourcePath: string,
  signal?: AbortSignal,
  threshold = 0.28,
): Promise<SceneCut[]> {
  const result = await runProcess(
    ffmpeg,
    [
      '-hide_banner',
      '-nostdin',
      '-i',
      sourcePath,
      '-filter:v',
      `select='gt(scene,${threshold})',metadata=print:file=-`,
      '-an',
      '-f',
      'null',
      '-',
    ],
    { signal, captureLimit: 2 * 1024 * 1024 },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const cuts: SceneCut[] = [];
  let pendingTime: number | null = null;
  for (const line of output.split(/\r?\n/)) {
    const time = /pts_time:([0-9.]+)/.exec(line);
    if (time) {
      pendingTime = Number(time[1]);
      continue;
    }
    const score = /lavfi\.scene_score=([0-9.]+)/.exec(line);
    if (score && pendingTime !== null) {
      const parsed = Number(score[1]);
      if (Number.isFinite(parsed) && Number.isFinite(pendingTime)) {
        cuts.push({ timeSeconds: pendingTime, score: parsed });
      }
      pendingTime = null;
    }
  }
  return cuts.sort((left, right) => left.timeSeconds - right.timeSeconds);
}
