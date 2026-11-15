import { readFileSync, statSync } from 'node:fs';
import { VISUAL_REVIEW_LIMITS } from '@kerf/tools';

export function storyboardImages(output: unknown) {
  const frames = (output as { frames?: unknown })?.frames;
  if (!Array.isArray(frames)) return [];
  let remaining = VISUAL_REVIEW_LIMITS.imageBytes;
  const images: { frame: number; data: string; mimeType: 'image/png' }[] = [];
  for (const frame of frames.slice(0, VISUAL_REVIEW_LIMITS.framesPerPass)) {
    if (
      typeof frame?.path !== 'string' ||
      !Number.isInteger(frame?.frame) ||
      frame?.mimeType !== 'image/png'
    )
      continue;
    try {
      const size = statSync(frame.path).size;
      if (size <= 0 || size > remaining) continue;
      const bytes = readFileSync(frame.path);
      if (bytes.length > remaining) continue;
      remaining -= bytes.length;
      images.push({
        frame: frame.frame,
        data: bytes.toString('base64'),
        mimeType: 'image/png',
      });
    } catch {
      /* Cache eviction must not masquerade as delivered visual evidence. */
    }
  }
  return images;
}
