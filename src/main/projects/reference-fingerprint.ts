import { createHash } from 'node:crypto';
import type { ProjectSnapshot } from '../../shared/contracts';

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function referenceFingerprint(
  snapshot: Pick<ProjectSnapshot, 'project' | 'assets'>,
  kind: 'clip' | 'asset',
  id: string,
): string | null {
  if (kind === 'asset') {
    const asset = snapshot.assets.find((a) => a.id === id);
    return asset && asset.status !== 'missing'
      ? digest([
          asset.sourcePath,
          asset.contentHash,
          asset.fileSize,
          asset.mtimeMs,
        ])
      : null;
  }
  for (const track of snapshot.project.sequence.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) {
      if (
        'assetId' in clip &&
        !referenceFingerprint(snapshot, 'asset', clip.assetId)
      )
        return null;
      return digest([
        track.id,
        clip,
        'assetId' in clip
          ? referenceFingerprint(snapshot, 'asset', clip.assetId)
          : null,
      ]);
    }
  }
  return null;
}
