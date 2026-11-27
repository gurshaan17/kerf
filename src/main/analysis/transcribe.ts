import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Asset, FrameRate, Transcript, TranscriptWord } from '@kerf/model';
import {
  createTranscript,
  newId,
  secondsToFrames,
  transcriptSegmentSchema,
} from '@kerf/model';
import { extractAudioWav } from './media';
import { runWhisper } from './whisper';

interface WhisperTimestamp {
  readonly from_ms?: number;
  readonly to_ms?: number;
  readonly from?: string | number;
  readonly to?: string | number;
}

interface WhisperEntry {
  readonly text?: string;
  readonly timestamps?: WhisperTimestamp;
  readonly offsets?: { readonly from?: number; readonly to?: number };
  readonly start?: number;
  readonly end?: number;
  readonly tokens?: readonly {
    readonly text?: string;
    readonly p?: number;
    readonly offsets?: { readonly from?: number; readonly to?: number };
  }[];
}

interface WhisperDocument {
  readonly transcription?: WhisperEntry[];
  readonly segments?: WhisperEntry[];
  readonly result?: { readonly language?: string };
  readonly params?: { readonly language?: string };
  readonly text?: string;
}

export interface TranscriptionInput {
  readonly asset: Asset;
  readonly ffmpeg: string;
  readonly whisper: string;
  readonly model: string;
  readonly workDirectory: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number) => void;
  readonly now?: () => number;
}

function entryText(entry: WhisperEntry): string {
  return (entry.text ?? '').replace(/\s+/g, ' ').trim();
}

function entryFrames(
  entry: WhisperEntry,
  rate: FrameRate,
): { start: number; end: number } | null {
  const timestamps = entry.timestamps;
  const fromMs = timestamps?.from_ms;
  const toMs = timestamps?.to_ms;
  if (
    typeof fromMs === 'number' &&
    Number.isFinite(fromMs) &&
    typeof toMs === 'number' &&
    Number.isFinite(toMs)
  ) {
    return {
      start: secondsToFrames(fromMs / 1000, rate),
      end: secondsToFrames(toMs / 1000, rate),
    };
  }
  const offsets = entry.offsets;
  if (typeof offsets?.from === 'number' && typeof offsets.to === 'number') {
    return {
      start: secondsToFrames(offsets.from / 1000, rate),
      end: secondsToFrames(offsets.to / 1000, rate),
    };
  }
  if (typeof entry.start === 'number' && typeof entry.end === 'number') {
    return {
      start: secondsToFrames(entry.start, rate),
      end: secondsToFrames(entry.end, rate),
    };
  }
  return null;
}

function splitEntry(
  text: string,
  start: number,
  end: number,
): Array<{ text: string; startFrame: number; endFrame: number }> {
  const parts = text.split(' ').filter((part) => part.length > 0);
  if (parts.length === 0) {
    return [];
  }
  if (parts.length === 1) {
    return [{ text: parts[0] ?? text, startFrame: start, endFrame: end }];
  }
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const span = Math.max(parts.length, end - start);
  let cursor = start;
  return parts.map((part, index) => {
    const width =
      index === parts.length - 1
        ? Math.max(1, end - cursor)
        : Math.max(
            1,
            Math.round((span * part.length) / Math.max(1, totalLength)),
          );
    const word = {
      text: part,
      startFrame: cursor,
      endFrame: cursor + width,
    };
    cursor += width;
    return word;
  });
}

function alignWord(
  entry: WhisperEntry,
  text: string,
): Pick<TranscriptWord, 'alignment' | 'confidence'> | null {
  if (text.includes(' ') || !Array.isArray(entry.tokens)) return null;
  const tokens = entry.tokens.filter(
    (token) => token.text && !/^\[_.*\]$/.test(token.text),
  );
  if (
    tokens
      .map((token) => token.text)
      .join('')
      .trim() !== text
  )
    return null;
  const speech = tokens.filter((token) =>
    /[\p{L}\p{N}]/u.test(token.text ?? ''),
  );
  if (!speech.length) return null;
  let startMs = -1;
  let endMs = -1;
  let confidence = 1;
  for (const token of speech) {
    const from = token.offsets?.from;
    const to = token.offsets?.to;
    if (
      typeof from !== 'number' ||
      typeof to !== 'number' ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      from < endMs ||
      to <= from ||
      typeof token.p !== 'number' ||
      !Number.isFinite(token.p) ||
      token.p < 0.5 ||
      token.p > 1
    )
      return null;
    if (startMs === -1) startMs = from;
    endMs = to;
    confidence = Math.min(confidence, token.p);
  }
  return { alignment: { method: 'whisper-token', startMs, endMs }, confidence };
}

export function transcriptFromWhisper(
  document: WhisperDocument,
  asset: Asset,
  rate: FrameRate,
  model: string,
  now = Date.now(),
): Transcript {
  const entries = document.transcription ?? document.segments ?? [];
  const words: TranscriptWord[] = [];

  for (const entry of entries) {
    const text = entryText(entry);
    const frames = entryFrames(entry, rate);
    if (text.length === 0 || !frames) {
      continue;
    }
    const aligned = alignWord(entry, text);
    for (const word of splitEntry(text, frames.start, frames.end)) {
      words.push({
        text: word.text,
        startFrame: word.startFrame,
        endFrame: Math.max(word.startFrame, word.endFrame),
        confidence: 1,
        ...aligned,
      });
    }
  }

  const segments = [];
  for (let index = 0; index < words.length; index += 12) {
    const chunk = words.slice(index, index + 12);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) {
      continue;
    }
    segments.push(
      transcriptSegmentSchema.parse({
        id: newId('segment'),
        startFrame: first.startFrame,
        endFrame: last.endFrame,
        text: chunk.map((word) => word.text).join(' '),
        words: chunk,
      }),
    );
  }

  const language =
    document.result?.language ?? document.params?.language ?? 'en';
  return createTranscript({
    assetId: asset.id,
    segments,
    language: language.length >= 2 ? language : 'en',
    model,
    now,
  });
}

export async function transcribeAsset(
  input: TranscriptionInput,
): Promise<Transcript> {
  if (!input.asset.hasAudio && input.asset.kind !== 'audio') {
    throw new Error('The asset does not contain an audio stream.');
  }
  mkdirSync(input.workDirectory, { recursive: true });
  const suffix = `${input.asset.id}-${Date.now()}`;
  const wavPath = join(input.workDirectory, `${suffix}.wav`);
  const outPrefix = join(input.workDirectory, `${suffix}-whisper`);
  const jsonPath = `${outPrefix}.json`;
  try {
    const before = statSync(input.asset.sourcePath);
    input.onProgress?.(0.05);
    await extractAudioWav(
      input.ffmpeg,
      input.asset.sourcePath,
      wavPath,
      input.signal,
    );
    input.onProgress?.(0.2);
    await runWhisper(
      input.whisper,
      [
        '-m',
        input.model,
        '-f',
        wavPath,
        '-l',
        'auto',
        '-ojf',
        '-of',
        outPrefix,
        '-ml',
        '1',
        '-sow',
      ],
      {
        signal: input.signal,
        onProgress: (progress) => input.onProgress?.(0.2 + progress * 0.75),
      },
    );
    const raw = readFileSync(jsonPath, 'utf8');
    let document: WhisperDocument;
    try {
      document = JSON.parse(raw) as WhisperDocument;
    } catch (error) {
      throw new Error('Whisper produced an unreadable JSON transcript.', {
        cause: error,
      });
    }
    const rate = input.asset.frameRate ?? { numerator: 24, denominator: 1 };
    input.onProgress?.(0.98);
    const after = statSync(input.asset.sourcePath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error(
        'The source changed during transcription. Transcribe it again.',
      );
    return {
      ...transcriptFromWhisper(
        document,
        input.asset,
        rate,
        basename(input.model),
        input.now?.() ?? Date.now(),
      ),
      alignmentSource: {
        path: input.asset.sourcePath,
        size: after.size,
        mtimeMs: after.mtimeMs,
      },
    };
  } finally {
    rmSync(wavPath, { force: true });
    rmSync(jsonPath, { force: true });
  }
}
