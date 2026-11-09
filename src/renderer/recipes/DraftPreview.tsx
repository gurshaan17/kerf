import { useEffect, useState } from 'react';
import type { Sequence } from '@kerf/model';
import type { ProjectSnapshot } from '../../shared/contracts';
import { StudioStoreProvider } from '../state/StudioProvider';
import {
  createStudioStore,
  useStudio as useStudioStore,
} from '../state/studio';
import type { StudioStore } from '../state/studio';
import { sequenceDurationFrames } from '@kerf/engine';
import { Preview } from '../preview/Preview';

/** Uses the editor's renderer and playback in a store that never hydrates or subscribes. */
export function DraftPreview({
  snapshot,
  sequence,
  frame = 0,
}: {
  snapshot: ProjectSnapshot;
  sequence: Sequence;
  frame?: number;
}) {
  const [store] = useState(() => createStudioStore(window.kerf));
  useEffect(() => {
    store.setState({
      snapshot: { ...snapshot, project: { ...snapshot.project, sequence } },
      selection: { clipIds: [], trackId: null },
      playhead: frame,
      playing: false,
    });
    return () => {
      store.getState().setPlaying(false);
    };
  }, [snapshot, sequence, frame, store]);
  return (
    <StudioStoreProvider store={store}>
      <div className="bp-player">
        <Preview initialSafeZones={false} />
        <DraftScrubber
          store={store}
          duration={sequenceDurationFrames(sequence)}
        />
      </div>
    </StudioStoreProvider>
  );
}

function DraftScrubber({
  store,
  duration,
}: {
  store: StudioStore;
  duration: number;
}) {
  const frame = useStudioStore(store, (state) => state.playhead);
  return (
    <input
      className="bp-scrubber"
      type="range"
      aria-label="Draft position"
      min={0}
      max={Math.max(0, duration - 1)}
      value={Math.min(frame, Math.max(0, duration - 1))}
      onChange={(event) => {
        store.getState().setPlaying(false);
        store.getState().setPlayhead(Number(event.target.value));
      }}
    />
  );
}
