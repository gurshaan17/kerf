import { useState } from 'react';
import { ScanLine } from 'lucide-react';
import type { Scene } from '@kerf/model';

export function SceneThumbnail({ scene }: { readonly scene: Scene }) {
  const [failed, setFailed] = useState(false);

  if (!scene.thumbnailPath || failed) {
    return (
      <div className="grid h-full w-full place-content-center bg-surface-2 text-ink-faint">
        <ScanLine size={16} aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={`kerfmedia://scene/${encodeURIComponent(scene.id)}/thumbnail`}
      alt={`Scene ${scene.index + 1}`}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}
