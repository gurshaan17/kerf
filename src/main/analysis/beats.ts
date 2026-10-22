import type { Asset, BeatMap, FrameRate } from '@kerf/model';
import { beatMapSchema, newId, secondsToFrames } from '@kerf/model';
import { decodePcm } from './media';

export interface BeatAnalysis {
  readonly bpm: number;
  readonly offsetFrames: number;
  readonly beats: BeatMap['beats'];
  readonly sections: BeatMap['sections'];
}

interface OnsetEnvelope {
  readonly values: number[];
  readonly hopSeconds: number;
}

function onsetEnvelope(
  samples: Float32Array,
  sampleRate: number,
  hopSize: number,
): OnsetEnvelope {
  const frameCount = Math.ceil(samples.length / hopSize);
  const energy = new Float64Array(frameCount + 1);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    const start = frame * hopSize;
    const end = Math.min(samples.length, start + hopSize);
    for (let index = start; index < end; index += 1) {
      const value = samples[index] ?? 0;
      sum += value * value;
    }
    energy[frame] = Math.sqrt(sum / Math.max(1, end - start));
  }
  const values: number[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const current = energy[frame] ?? 0;
    const previous = energy[frame - 1] ?? 0;
    values.push(Math.max(0, current - previous));
  }
  const max = values.reduce((peak, value) => Math.max(peak, value), 0);
  if (max > 0) {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = (values[index] ?? 0) / max;
    }
  }
  return { values, hopSeconds: hopSize / sampleRate };
}

function interpolate(values: readonly number[], index: number): number {
  if (index < 0 || index >= values.length) {
    return 0;
  }
  const lower = Math.floor(index);
  const upper = Math.min(values.length - 1, Math.ceil(index));
  const fraction = index - lower;
  return (
    (values[lower] ?? 0) * (1 - fraction) + (values[upper] ?? 0) * fraction
  );
}

function scorePeriod(onsets: readonly number[], period: number): number {
  let score = 0;
  let weight = 0;
  for (let index = 0; index < onsets.length; index += 1) {
    const next = interpolate(onsets, index + period);
    score += (onsets[index] ?? 0) * next;
    weight += (onsets[index] ?? 0) ** 2;
  }
  return weight > 0 ? score / Math.sqrt(weight) : 0;
}

function bestPhase(
  onsets: readonly number[],
  period: number,
): { phase: number; score: number } {
  const steps = Math.max(1, Math.round(period));
  let best = { phase: 0, score: -Infinity };
  for (let phase = 0; phase < steps; phase += 1) {
    let score = 0;
    let count = 0;
    for (let position = phase; position < onsets.length; position += period) {
      score += interpolate(onsets, position);
      count += 1;
    }
    const normalized = count > 0 ? score / Math.sqrt(count) : 0;
    if (normalized > best.score) {
      best = { phase, score: normalized };
    }
  }
  return best;
}

function buildSections(
  beats: BeatMap['beats'],
  onsets: readonly number[],
): BeatMap['sections'] {
  if (beats.length < 2) {
    return [];
  }
  const firstFrame = beats[0]?.frame ?? 0;
  const lastFrame = beats[beats.length - 1]?.frame ?? firstFrame + 1;
  const bars = Math.max(1, Math.ceil(beats.length / 4));
  const barsPerSection = 8;
  const sectionCount = Math.max(1, Math.ceil(bars / barsPerSection));
  const framesPerSection = Math.max(
    2,
    Math.ceil((lastFrame - firstFrame + 1) / sectionCount),
  );
  const energies: number[] = [];
  for (let index = 0; index < sectionCount; index += 1) {
    let sum = 0;
    let count = 0;
    for (
      let position = index * framesPerSection;
      position < Math.min(onsets.length, (index + 1) * framesPerSection);
      position += 1
    ) {
      sum += onsets[position] ?? 0;
      count += 1;
    }
    energies.push(count > 0 ? sum / count : 0);
  }
  const peak = Math.max(...energies, 0.0001);
  return energies.map((energy, index) => {
    const startFrame = firstFrame + index * framesPerSection;
    const endFrame =
      index === sectionCount - 1
        ? Math.max(startFrame + 1, lastFrame + 1)
        : startFrame + framesPerSection;
    const ratio = energy / peak;
    const label =
      index === 0
        ? 'Intro'
        : index === sectionCount - 1
          ? 'Outro'
          : ratio > 0.55
            ? 'Peak'
            : ratio > 0.22
              ? 'Main'
              : 'Break';
    return {
      id: newId('section'),
      label: `${label} ${index + 1}`,
      startFrame,
      endFrame,
    };
  });
}

export function detectBeatAnalysis(
  samples: Float32Array,
  sampleRate: number,
  rate: FrameRate,
  durationFrames: number,
): BeatAnalysis {
  const hopSize = Math.max(64, Math.round(sampleRate / 100));
  const { values, hopSeconds } = onsetEnvelope(samples, sampleRate, hopSize);
  const minBpm = 60;
  const maxBpm = 200;
  let best = { bpm: 120, period: 0, score: -Infinity };
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
    const period = 60 / bpm / hopSeconds;
    if (period < 2 || period > values.length / 2) {
      continue;
    }
    const score = scorePeriod(values, period);
    if (score > best.score) {
      best = { bpm, period, score };
    }
  }
  const phase = bestPhase(values, best.period);
  const periodSeconds = 60 / best.bpm;
  const offsetSeconds = phase.phase * hopSeconds;
  const beats: BeatMap['beats'] = [];
  const sampleDuration = samples.length / sampleRate;
  for (
    let time = offsetSeconds;
    time <= sampleDuration + periodSeconds * 0.01 && beats.length < 20_000;
    time += periodSeconds
  ) {
    const frame = Math.min(
      Math.max(0, durationFrames - 1),
      secondsToFrames(time, rate),
    );
    if (beats.some((beat) => beat.frame === frame)) {
      continue;
    }
    const onsetIndex = Math.round(time / hopSeconds);
    beats.push({
      id: newId('beat'),
      frame,
      strength: Math.max(0.05, Math.min(1, interpolate(values, onsetIndex))),
    });
  }
  const ordered = beats.sort((left, right) => left.frame - right.frame);
  const sections = buildSections(ordered, values);
  return {
    bpm: Math.round(best.bpm * 10) / 10,
    offsetFrames: secondsToFrames(offsetSeconds, rate),
    beats: ordered,
    sections,
  };
}

export interface DetectBeatMapInput {
  readonly asset: Asset;
  readonly ffmpeg: string;
  readonly rate: FrameRate;
  readonly durationFrames: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number) => void;
  readonly now?: () => number;
}

export async function detectBeatMap(
  input: DetectBeatMapInput,
): Promise<BeatMap> {
  if (!input.asset.hasAudio && input.asset.kind !== 'audio') {
    throw new Error('The asset does not contain an audio stream.');
  }
  input.onProgress?.(0.05);
  const samples = await decodePcm(
    input.ffmpeg,
    input.asset.sourcePath,
    input.signal,
  );
  input.onProgress?.(0.75);
  const analysis = detectBeatAnalysis(
    samples,
    16_000,
    input.rate,
    input.durationFrames,
  );
  input.onProgress?.(1);
  return beatMapSchema.parse({
    id: newId('beatmap'),
    assetId: input.asset.id,
    bpm: analysis.bpm,
    offsetFrames: analysis.offsetFrames,
    beats: analysis.beats,
    sections: analysis.sections,
    createdAt: input.now?.() ?? Date.now(),
  });
}
