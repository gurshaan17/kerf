import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
  newId,
  secondsToFrames,
  transcriptSegmentSchema,
  type FrameRate,
  type TranscriptSegment,
} from '@kerf/model';
import { runFfmpeg } from '../media/ffmpeg';

export interface VisualSample {
  time: number;
  score: number;
}
export interface VisualChunk {
  index: number;
  samples: VisualSample[];
  end: number;
}
interface Observation {
  text: string;
  evidence: number[];
  chunk: number;
}
const outputSchema = z.object({
  segments: z
    .array(
      z.object({
        startFrameIndex: z.number().int().nonnegative(),
        endFrameIndex: z.number().int().nonnegative(),
        text: z.string().trim().min(1).max(600),
      }),
    )
    .max(8),
});

export const VISUAL_PROMPT =
  'Create concise visual narration for a tutorial. Prioritize meaningful user actions and visible outcomes: commands run, pages opened, settings changed, results shown. Do not describe cursor movement, hovers, zooms, spinners, or a speaker merely remaining present unless they change the outcome. Merge consecutive micro-steps. Rough target: 4-8 descriptions per minute; return zero rows for chunks with no meaningful change, static or black footage. Describe only visible evidence; never infer intent or speech. Quote only legible important text. Avoid repeating unchanged content from context, but describe actions that visibly occur again. Return ONLY one JSON object: {"segments":[{"startFrameIndex":0,"endFrameIndex":0,"text":"..."}]}. Indices reference supplied images; end is inclusive evidence. Evidence may overlap, but use distinct chronological start indices. Context-only images establish starting state: never use them as output endpoints.';

export function visualBudget(
  candidates: VisualSample[],
  cap = 600,
): VisualSample[] {
  const buckets = new Map<number, VisualSample>();
  for (const sample of candidates) {
    const key = Math.floor(sample.time / 10);
    if (!buckets.has(key) || buckets.get(key)!.score < sample.score)
      buckets.set(key, sample);
  }
  const kept = new Set(buckets.values());
  if (candidates[0]) kept.add(candidates[0]);
  if (kept.size > cap)
    throw new Error(
      'Select a shorter range: temporal coverage exceeds the frame budget.',
    );
  for (const sample of [...candidates].sort(
    (a, b) => b.score - a.score || a.time - b.time,
  )) {
    if (kept.size >= cap) break;
    kept.add(sample);
  }
  return [...kept].sort((a, b) => a.time - b.time);
}

export function visualChunks(
  samples: VisualSample[],
  end: number,
): VisualChunk[] {
  const chunks: VisualChunk[] = [];
  for (const sample of samples) {
    let chunk = chunks.at(-1);
    if (
      !chunk ||
      chunk.samples.length >= 8 ||
      sample.time - chunk.samples[0]!.time >= 12
    ) {
      chunk = { index: chunks.length, samples: [], end };
      chunks.push(chunk);
    }
    chunk.samples.push(sample);
  }
  for (let i = 0; i < chunks.length - 1; i++)
    chunks[i]!.end = chunks[i + 1]!.samples[0]!.time;
  return chunks;
}

export function parseVisualOutput(
  text: string,
  frames: readonly { time: number; contextOnly: boolean }[],
  chunk: number,
): Observation[] {
  const fence = text.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  let value: z.infer<typeof outputSchema>;
  try {
    value = outputSchema.parse(JSON.parse(fence ? fence[1]! : text));
  } catch {
    throw new Error(
      'Vision returned invalid JSON or description data. No draft was replaced.',
    );
  }
  let previous = -1;
  return value.segments.map((row) => {
    if (
      row.startFrameIndex <= previous ||
      row.endFrameIndex < row.startFrameIndex ||
      !frames[row.endFrameIndex] ||
      frames[row.startFrameIndex]?.contextOnly ||
      frames[row.endFrameIndex]?.contextOnly
    )
      throw new Error(
        'Vision returned invalid, unordered or context-only evidence indices.',
      );
    previous = row.startFrameIndex;
    return {
      text: row.text,
      evidence: frames
        .slice(row.startFrameIndex, row.endFrameIndex + 1)
        .map((f) => f.time),
      chunk,
    };
  });
}

export function narrationIntervals(
  rows: Observation[],
  rate: FrameRate,
  endFrame: number,
  holdSeconds = 3,
): TranscriptSegment[] {
  const merged: Observation[] = [];
  for (const row of rows) {
    const previous = merged.at(-1);
    // Exact wording only; visually repeated actions far apart are retained.
    if (
      previous &&
      previous.chunk !== row.chunk &&
      row.evidence[0]! - previous.evidence.at(-1)! <= 0.25 &&
      previous.text.toLowerCase().trim() === row.text.toLowerCase().trim()
    )
      previous.evidence = [...new Set([...previous.evidence, ...row.evidence])];
    else merged.push({ ...row, evidence: [...row.evidence] });
  }
  const starts = merged.map((row) => secondsToFrames(row.evidence[0]!, rate));
  return merged.map((row, i) => {
    const startFrame = starts[i]!;
    const end =
      i + 1 < merged.length
        ? starts[i + 1]!
        : Math.min(endFrame, startFrame + secondsToFrames(holdSeconds, rate));
    if (
      startFrame < 0 ||
      end <= startFrame ||
      end > endFrame ||
      (i > 0 && startFrame <= starts[i - 1]!)
    )
      throw new Error(
        'Vision output has invalid narration timing. No draft was replaced.',
      );
    return transcriptSegmentSchema.parse({
      id: newId('segment'),
      text: row.text,
      startFrame,
      endFrame: end,
      origin: 'generated',
      evidenceFrames: row.evidence.map((time) => secondsToFrames(time, rate)),
    });
  });
}

export async function visualWaves<T>(
  chunks: VisualChunk[],
  width: number,
  run: (chunk: VisualChunk, context: T[], signal: AbortSignal) => Promise<T[]>,
  signal: AbortSignal,
): Promise<T[]> {
  const completed: T[][] = [];
  for (let offset = 0; offset < chunks.length; offset += width) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const context = offset ? completed[offset - 1]!.slice(-3) : [];
    let failure: unknown;
    const wave = await Promise.allSettled(
      chunks.slice(offset, offset + width).map(async (chunk) => {
        try {
          return await run(chunk, context, combined);
        } catch (error) {
          failure ??= error;
          controller.abort(error);
          throw error;
        }
      }),
    );
    signal.throwIfAborted();
    if (failure) throw failure;
    for (const result of wave)
      if (result.status === 'fulfilled') completed.push(result.value);
  }
  return completed.flat();
}

async function sampleVideo(
  ffmpeg: string,
  path: string,
  start: number,
  end: number,
  cuts: number[],
  signal: AbortSignal,
): Promise<{ samples: VisualSample[]; candidates: number }> {
  const child = spawn(
    ffmpeg,
    [
      '-nostdin',
      '-v',
      'error',
      '-ss',
      String(start),
      '-i',
      path,
      '-t',
      String(end - start),
      '-vf',
      'fps=4,scale=160:90',
      '-an',
      '-pix_fmt',
      'gray',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { signal, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr = (stderr + data).slice(-2000);
  });
  const completion = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Frame sampling failed (${code}): ${stderr}`)),
    );
  });
  void completion.catch(() => undefined);
  const candidates: VisualSample[] = [];
  let pending = Buffer.alloc(0);
  let previous: Buffer | undefined;
  let index = 0;
  let last = -Infinity;
  for await (const data of child.stdout) {
    pending = Buffer.concat([pending, data]);
    while (pending.length >= 14400) {
      const frame = Buffer.from(pending.subarray(0, 14400));
      pending = pending.subarray(14400);
      const time = start + index++ / 4;
      let score = 0;
      if (previous)
        for (let i = 0; i < frame.length; i++)
          score += Math.abs(frame[i]! - previous[i]!);
      score /= 14400 * 255;
      const cut = cuts.some((t) => Math.abs(t - time) < 0.125);
      if (time < end && (score >= 0.025 || time - last >= 2 || cut)) {
        candidates.push({ time, score: cut ? 1 : score });
        last = time;
      }
      previous = frame;
    }
  }
  await completion;
  return { samples: visualBudget(candidates), candidates: candidates.length };
}

export interface VisualNarrationInput {
  path: string;
  ffmpeg: string;
  workRoot: string;
  rate: FrameRate;
  startFrame: number;
  endFrame: number;
  model: LanguageModel;
  width: number;
  signal: AbortSignal;
  sceneCuts: number[];
  checkProvider: () => void;
  progress: (fraction: number, stage: string) => void;
}
export async function generateVisualNarration(
  input: VisualNarrationInput,
): Promise<{
  segments: TranscriptSegment[];
  sampleCount: number;
  candidateCount: number;
}> {
  const { signal } = input;
  const seconds = (frame: number) =>
    (frame * input.rate.denominator) / input.rate.numerator;
  input.progress(0.02, 'Sampling visual changes');
  const sampled = await sampleVideo(
    input.ffmpeg,
    input.path,
    seconds(input.startFrame),
    seconds(input.endFrame),
    input.sceneCuts,
    signal,
  );
  const chunks = visualChunks(sampled.samples, seconds(input.endFrame));
  mkdirSync(input.workRoot, { recursive: true });
  const work = mkdtempSync(join(input.workRoot, 'visual-'));
  try {
    const images = new Map<number, string>();
    for (let i = 0; i < sampled.samples.length; i++) {
      signal.throwIfAborted();
      const sample = sampled.samples[i]!;
      const file = join(work, `${i}.jpg`);
      await runFfmpeg(
        input.ffmpeg,
        [
          '-nostdin',
          '-v',
          'error',
          '-y',
          '-ss',
          String(sample.time),
          '-i',
          input.path,
          '-frames:v',
          '1',
          '-vf',
          'scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2',
          '-pix_fmt',
          'yuvj420p',
          '-q:v',
          '3',
          '-map_metadata',
          '-1',
          file,
        ],
        { signal },
      );
      images.set(sample.time, file);
      input.progress(
        0.15 + (0.2 * (i + 1)) / sampled.samples.length,
        'Extracting evidence frames',
      );
    }
    let completed = 0;
    const rows = await visualWaves<Observation>(
      chunks,
      input.width,
      async (chunk, context, callSignal) => {
        callSignal.throwIfAborted();
        input.checkProvider();
        const preceding = chunk.index
          ? chunks[chunk.index - 1]!.samples.at(-1)
          : null;
        const frames = [
          ...(preceding ? [{ ...preceding, contextOnly: true }] : []),
          ...chunk.samples.map((s) => ({ ...s, contextOnly: false })),
        ];
        const parts = frames.flatMap((frame, index) => [
          {
            type: 'text' as const,
            text: `Frame ${index}: ${frame.time.toFixed(3)}s, ${frame.contextOnly ? 'CONTEXT ONLY' : 'OUTPUT ELIGIBLE'}`,
          },
          {
            type: 'file' as const,
            data: readFileSync(images.get(frame.time)!),
            mediaType: 'image/jpeg',
          },
        ]);
        const result = await generateText({
          model: input.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    VISUAL_PROMPT +
                    ' Secondary context: ' +
                    JSON.stringify(context),
                },
                ...parts,
              ],
            },
          ],
          maxOutputTokens: 8192,
          maxRetries: 0,
          abortSignal: AbortSignal.any([
            callSignal,
            AbortSignal.timeout(120000),
          ]),
        });
        const parsed = parseVisualOutput(result.text, frames, chunk.index);
        input.progress(
          0.35 + 0.6 * (++completed / chunks.length),
          `Describing ${completed}/${chunks.length} chunks (${sampled.samples.length} frames)`,
        );
        return parsed;
      },
      signal,
    );
    signal.throwIfAborted();
    return {
      segments: narrationIntervals(rows, input.rate, input.endFrame),
      sampleCount: sampled.samples.length,
      candidateCount: sampled.candidates,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
