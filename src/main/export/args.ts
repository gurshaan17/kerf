import type { ExportAudioClip } from './audio-plan';

export interface ExportEncodePlan {
  readonly framePattern: string;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly outputPath: string;
  readonly audioClips: readonly ExportAudioClip[];
}

function seconds(value: number): string {
  return Math.max(0, value).toFixed(6);
}

function atempoFilters(speed: number): string[] {
  let remaining = Math.max(0.01, speed);
  const filters: string[] = [];
  while (remaining > 2) {
    filters.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters;
}

function audioFilter(clip: ExportAudioClip, input: number): string {
  const filters = [
    'asetpts=PTS-STARTPTS',
    `atrim=0:${seconds(clip.sourceDurationSeconds)}`,
    'asetpts=PTS-STARTPTS',
  ];
  if (clip.reversed) {
    filters.push('areverse');
  }
  if (Math.abs(clip.speed - 1) > 0.001) {
    filters.push(...atempoFilters(clip.speed));
  }
  filters.push(`atrim=0:${seconds(clip.timelineDurationSeconds)}`);
  if (clip.volume !== 1) {
    filters.push(`volume=${clip.volume.toFixed(4)}`);
  }
  if (clip.fadeInSeconds > 0) {
    filters.push(`afade=t=in:st=0:d=${seconds(clip.fadeInSeconds)}`);
  }
  if (clip.fadeOutSeconds > 0) {
    const start = Math.max(
      0,
      clip.timelineDurationSeconds - clip.fadeOutSeconds,
    );
    filters.push(
      `afade=t=out:st=${seconds(start)}:d=${seconds(clip.fadeOutSeconds)}`,
    );
  }
  filters.push('aformat=sample_rates=48000:channel_layouts=stereo');
  const delayMs = Math.round(clip.delaySeconds * 1000);
  if (delayMs > 0) {
    filters.push(`adelay=${delayMs}|${delayMs}`);
  }
  return `[${input}:a]${filters.join(',')}[a${input}]`;
}

/**
 * Builds the single ffmpeg encode pass used after the renderer has written
 * PNG frames. Audio clips are trimmed, time-stretched, faded and delayed into
 * the same timeline window as the image sequence.
 */
export function buildExportArgs(plan: ExportEncodePlan): string[] {
  const args = [
    '-y',
    '-hide_banner',
    '-nostdin',
    '-framerate',
    seconds(plan.frameRate),
    '-start_number',
    '1',
    '-i',
    plan.framePattern,
  ];

  for (const clip of plan.audioClips) {
    args.push(
      '-ss',
      seconds(clip.sourceStartSeconds),
      '-t',
      seconds(clip.sourceDurationSeconds),
      '-i',
      clip.path,
    );
  }

  args.push(
    '-map',
    '0:v:0',
    '-frames:v',
    String(plan.frameCount),
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-r',
    seconds(plan.frameRate),
    '-movflags',
    '+faststart',
    '-t',
    seconds(plan.durationSeconds),
  );

  if (plan.audioClips.length === 0) {
    args.push('-an');
  } else {
    const filters = plan.audioClips.map((clip, index) =>
      audioFilter(clip, index + 1),
    );
    const labels = plan.audioClips.map((_, index) => `[a${index + 1}]`);
    filters.push(
      `${labels.join('')}amix=inputs=${plan.audioClips.length}:duration=longest:normalize=0,` +
        `alimiter=limit=0.98,atrim=0:${seconds(plan.durationSeconds)},` +
        'asetpts=PTS-STARTPTS[aout]',
    );
    args.push(
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[aout]',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
    );
  }

  args.push(plan.outputPath);
  return args;
}
