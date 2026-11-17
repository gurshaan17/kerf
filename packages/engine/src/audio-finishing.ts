import type {
  Asset,
  AudibleClip,
  EditCommand,
  NumberKeyframe,
  Sequence,
  Transcript,
} from '@kerf/model';
import { fpsToNumber } from '@kerf/model';

export interface DuckRequest {
  speechClipIds: readonly string[];
  backgroundClipIds: readonly string[];
  gain: number;
  attackMs: number;
  releaseMs: number;
}
export function speechDuckingCommand(
  sequence: Sequence,
  assets: readonly Asset[],
  transcripts: readonly Transcript[],
  input: DuckRequest,
) {
  if (
    !Number.isFinite(input.gain) ||
    input.gain < 0 ||
    input.gain > 1 ||
    !Number.isFinite(input.attackMs) ||
    !Number.isFinite(input.releaseMs) ||
    input.attackMs < 20 ||
    input.releaseMs < 20
  )
    throw new Error(
      'Choose a ducking gain from zero to one and positive attack/release ramps.',
    );
  const all = sequence.tracks.flatMap((track) =>
    track.clips.map((clip) => ({ track, clip })),
  );
  const get = (id: string) => {
    const found = all.find((c) => c.clip.id === id);
    if (!found || (found.clip.type !== 'audio' && found.clip.type !== 'video'))
      throw new Error(
        'Choose existing audio-bearing speech and background clips.',
      );
    return { track: found.track, clip: found.clip as AudibleClip };
  };
  if (
    !input.speechClipIds.length ||
    !input.backgroundClipIds.length ||
    new Set(input.speechClipIds).size !== input.speechClipIds.length ||
    new Set(input.backgroundClipIds).size !== input.backgroundClipIds.length
  )
    throw new Error('Choose unique speech and background clip IDs.');
  const fps = fpsToNumber(sequence.frameRate);
  const attack = Math.max(1, Math.round((input.attackMs * fps) / 1000));
  const release = Math.max(1, Math.round((input.releaseMs * fps) / 1000));
  const ranges: { start: number; end: number }[] = [];
  for (const id of input.speechClipIds) {
    const { clip } = get(id);
    if (clip.speed !== 1 || clip.timeMap.length)
      throw new Error(
        'Speech-envelope ducking requires normal-speed speech clips.',
      );
    const asset = assets.find((a) => a.id === clip.assetId);
    const transcript = transcripts.find(
      (t) =>
        t.assetId === clip.assetId &&
        t.source === 'speech' &&
        t.status === 'reviewed',
    );
    if (!transcript)
      throw new Error(
        'Review an indexed speech transcript for every selected speech source first.',
      );
    const sourceFps = fpsToNumber(
      asset?.frameRate ?? { numerator: 24, denominator: 1 },
    );
    for (const segment of transcript.segments.filter((s) => s.text.trim())) {
      const intervals = segment.words.length ? segment.words : [segment];
      for (const interval of intervals) {
        const start = Math.max(
          clip.startFrame,
          clip.startFrame +
            Math.floor((interval.startFrame / sourceFps) * fps) -
            clip.sourceInFrame,
        );
        const end = Math.min(
          clip.startFrame + clip.durationFrames,
          clip.startFrame +
            Math.ceil((interval.endFrame / sourceFps) * fps) -
            clip.sourceInFrame,
        );
        if (end > start) ranges.push({ start, end });
      }
    }
  }
  const merged: typeof ranges = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start - attack <= last.end + release)
      last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  if (!merged.length)
    throw new Error('No indexed speech intersects the selected clips.');
  if (merged.length > 40)
    throw new Error(
      'Scope ducking to at most forty speech intervals at a time.',
    );
  const speechAssets = new Set(
    transcripts.filter((t) => t.source === 'speech').map((t) => t.assetId),
  );
  const commands: EditCommand[] = [];
  const changed: string[] = [];
  for (const id of input.backgroundClipIds) {
    const { track, clip } = get(id);
    if (speechAssets.has(clip.assetId) || input.speechClipIds.includes(id))
      throw new Error(
        'A selected background contains indexed speech. Choose background music or ambience instead.',
      );
    if (clip.locked || track.locked || track.muted)
      throw new Error('Unlock and unmute background clips before ducking.');
    const local = merged.filter(
      (r) =>
        r.start - attack < clip.startFrame + clip.durationFrames &&
        r.end + release > clip.startFrame,
    );
    if (!local.length) continue;
    if (clip.keyframes.volume.length)
      throw new Error(
        'Background volume automation already exists. Preserve it or clear it explicitly before ducking.',
      );
    const points = new Map<number, number>([
      [0, clip.volume],
      [clip.durationFrames, clip.volume],
    ]);
    const add = (frame: number, value: number) => {
      if (frame > 0 && frame < clip.durationFrames) points.set(frame, value);
    };
    for (const range of local) {
      const start = range.start - clip.startFrame;
      const end = range.end - clip.startFrame;
      const down = clip.volume * input.gain;
      const at = (frame: number) =>
        frame < start - attack
          ? clip.volume
          : frame < start
            ? clip.volume +
              ((down - clip.volume) * (frame - start + attack)) / attack
            : frame <= end
              ? down
              : frame < end + release
                ? down + ((clip.volume - down) * (frame - end)) / release
                : clip.volume;
      add(start - attack, clip.volume);
      add(start, down);
      add(end, down);
      add(end + release, clip.volume);
      points.set(0, Math.min(points.get(0)!, at(0)));
      points.set(
        clip.durationFrames,
        Math.min(points.get(clip.durationFrames)!, at(clip.durationFrames)),
      );
    }
    const keyframes: NumberKeyframe[] = [...points]
      .sort(([a], [b]) => a - b)
      .map(([frame, value]) => ({ frame, value, easing: 'linear' }));
    commands.push({
      type: 'clip.setKeyframes',
      clipId: clip.id,
      property: 'volume',
      keyframes,
    });
    changed.push(clip.id);
  }
  return {
    command: {
      type: 'batch',
      label: 'Duck background under indexed speech',
      commands,
    } as EditCommand,
    backgroundClipIds: changed,
    intervalCount: merged.length,
    attackFrames: attack,
    releaseFrames: release,
  };
}
