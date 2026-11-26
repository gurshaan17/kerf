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
import { Preview } from './Preview';
import type { SceneTree } from '@kerf/motion';
import { Button } from '@kerf/ui';

const EMPTY_TREES: Readonly<Record<string, SceneTree>> = {};

/** Uses the editor's renderer and playback in a store that never hydrates or subscribes. */
export function IsolatedPreview({
  snapshot,
  sequence,
  frame = 0,
  compositionTrees = EMPTY_TREES,
  originalSequence,
}: {
  snapshot: ProjectSnapshot;
  sequence: Sequence;
  frame?: number;
  compositionTrees?: Readonly<Record<string, SceneTree>>;
  originalSequence?: Sequence;
}) {
  const [store] = useState(() => createStudioStore(window.kerf));
  const [original, setOriginal] = useState(false);
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
  useEffect(() => {
    store.setState({ compositionTrees });
  }, [compositionTrees, store]);
  return (
    <StudioStoreProvider store={store}>
      <div className="flex h-full min-h-0 flex-col [&_.k-stage]:min-h-0 [&_.k-stage]:flex-1">
        {originalSequence && (
          <div
            className="mb-2 flex gap-2"
            role="group"
            aria-label="Compare zoom"
          >
            {(
              [
                ['Original', true],
                ['With zoom', false],
              ] as const
            ).map(([label, showOriginal]) => (
              <Button
                key={label}
                size="sm"
                variant={original === showOriginal ? 'primary' : 'secondary'}
                aria-pressed={original === showOriginal}
                onClick={() => {
                  store.getState().setPlaying(false);
                  store.setState({
                    snapshot: {
                      ...snapshot,
                      project: {
                        ...snapshot.project,
                        sequence: showOriginal ? originalSequence : sequence,
                      },
                    },
                  });
                  setOriginal(showOriginal);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
        <Preview initialSafeZones={false} />
        <IsolatedScrubber
          store={store}
          duration={sequenceDurationFrames(sequence)}
        />
      </div>
    </StudioStoreProvider>
  );
}

function IsolatedScrubber({
  store,
  duration,
}: {
  store: StudioStore;
  duration: number;
}) {
  const frame = useStudioStore(store, (state) => state.playhead);
  return (
    <input
      className="mt-2 w-full accent-accent"
      type="range"
      aria-label="Proposal position"
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
