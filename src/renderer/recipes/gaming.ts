import { clipSchema, createTrack, newId } from '@kerf/model';
import type { Asset, EditCommand, Sequence, Transcript } from '@kerf/model';
import { timelineDurationFrames } from '@kerf/engine';

export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function gamingCommand(
  sequence: Sequence,
  asset: Asset,
  range: { sourceIn: number; duration: number; speed: number },
  webcam: Crop | null,
  captions: boolean,
  transcript: Transcript | undefined,
  placement: 'replace' | 'add',
): EditCommand {
  if (!asset.width || !asset.height)
    throw new Error('Wait for the video dimensions to load.');
  if (captions && !transcript)
    throw new Error('Transcribe this source before adding captions.');
  if (
    placement === 'replace' &&
    sequence.tracks.some((t) => t.locked || t.clips.some((c) => c.locked))
  )
    throw new Error('Unlock the timeline before replacing it.');
  const start = placement === 'add' ? timelineDurationFrames(sequence) : 0;
  const baseOrder =
    placement === 'add'
      ? Math.max(-1, ...sequence.tracks.map((t) => t.order)) + 1
      : 0;
  const gameplay = createTrack({
    kind: 'video',
    name: 'Gaming · Gameplay',
    order: baseOrder,
  });
  const camera = createTrack({
    kind: 'video',
    name: 'Gaming · Webcam',
    order: baseOrder + 1,
  });
  const captionTrack = createTrack({
    kind: 'caption',
    name: 'Gaming · Captions',
    order: baseOrder + 2,
  });
  // The compositor contains video in the canvas before applying clip transforms.
  const fit = Math.min(1080 / asset.width, 1920 / asset.height);
  const fw = asset.width * fit,
    fh = asset.height * fit;
  const panel = (
    crop: Crop,
    y: number,
    height: number,
    track: typeof gameplay,
    muted: boolean,
  ) => {
    const scale = Math.max(
      1080 / (fw * crop.width),
      height / (fh * crop.height),
    );
    const visibleW = 1080 / scale,
      visibleH = height / scale;
    const cx = (crop.x + crop.width / 2 - 0.5) * fw;
    const cy = (crop.y + crop.height / 2 - 0.5) * fh;
    track.clips.push(
      clipSchema.parse({
        id: newId('clip'),
        trackId: track.id,
        type: 'video',
        assetId: asset.id,
        label: muted ? 'Webcam crop' : asset.name,
        startFrame: start,
        durationFrames: range.duration,
        sourceInFrame: range.sourceIn,
        speed: range.speed,
        volume: muted ? 0 : 1,
        transform: {
          x: -cx * scale,
          y: y + height / 2 - 960 - cy * scale,
          scale,
        },
        masks: [
          {
            id: newId('mask'),
            type: 'rect',
            x: (cx - visibleW / 2 + 540) / 1080,
            y: (cy - visibleH / 2 + 960) / 1920,
            width: visibleW / 1080,
            height: visibleH / 1920,
          },
        ],
      }),
    );
  };
  panel(
    { x: 0, y: 0, width: 1, height: 1 },
    webcam ? 960 : 0,
    webcam ? 960 : 1920,
    gameplay,
    false,
  );
  if (webcam) panel(webcam, 0, 960, camera, true);
  if (captions && transcript) {
    for (const segment of transcript.segments) {
      const rawWords = segment.words.length
        ? segment.words
        : [
            {
              text: segment.text,
              startFrame: segment.startFrame,
              endFrame: segment.endFrame,
              confidence: 1,
            },
          ];
      const words = rawWords.filter(
        (word) =>
          word.endFrame > range.sourceIn &&
          word.startFrame < range.sourceIn + range.duration * range.speed,
      );
      for (let i = 0; i < words.length; i += 3) {
        const group = words.slice(i, i + 3);
        const from = Math.max(
          0,
          Math.round((group[0]!.startFrame - range.sourceIn) / range.speed),
        );
        const to = Math.min(
          range.duration,
          Math.round((group.at(-1)!.endFrame - range.sourceIn) / range.speed),
        );
        if (to <= from) continue;
        captionTrack.clips.push(
          clipSchema.parse({
            id: newId('clip'),
            trackId: captionTrack.id,
            type: 'caption',
            transcriptId: transcript.id,
            segmentId: segment.id,
            text: group
              .map((w) => w.text)
              .join(' ')
              .toUpperCase(),
            words: [],
            startFrame: start + from,
            durationFrames: to - from,
            style: {
              fontFamily: 'Instrument Sans',
              fontSize: 68,
              fontWeight: 900,
              color: '#ffffff',
              background: '#000000',
              padding: 10,
            },
            transform: { y: -1920 * 0.34 },
          }),
        );
      }
    }
    if (!captionTrack.clips.length)
      throw new Error('No transcript speech overlaps the selected clip.');
  }
  const tracks = [
    gameplay,
    ...(webcam ? [camera] : []),
    ...(captions ? [captionTrack] : []),
  ];
  return {
    type: 'batch',
    label: 'Apply gaming Blueprint',
    commands: [
      ...(placement === 'replace'
        ? sequence.tracks.map((t) => ({
            type: 'track.remove' as const,
            trackId: t.id,
          }))
        : []),
      { type: 'sequence.setCanvas', width: 1080, height: 1920 },
      ...tracks.map((track) => ({ type: 'track.add' as const, track })),
    ],
  };
}
