import { readFileSync, statSync } from 'node:fs';

/** Bound cached source imagery before forwarding it to either model surface. */
export function sourceFilmstripImages(output: unknown) {
  const frames = (output as { frames?: unknown })?.frames;
  if (!Array.isArray(frames)) return [];
  let remaining = 2_000_000;
  const images: { data: string; mimeType: 'image/jpeg'; frame: number }[] = [];
  for (const frame of frames.slice(0, 6)) {
    if (
      typeof frame?.path !== 'string' ||
      typeof frame?.frame !== 'number' ||
      frame?.mimeType !== 'image/jpeg'
    )
      continue;
    try {
      const size = statSync(frame.path).size;
      if (size > remaining || size <= 0) continue;
      const bytes = readFileSync(frame.path);
      if (bytes.length > remaining) continue;
      remaining -= bytes.length;
      images.push({
        data: bytes.toString('base64'),
        mimeType: 'image/jpeg',
        frame: frame.frame,
      });
    } catch {
      /* Thumbnails may be pruned after tool execution. */
    }
  }
  return images;
}
