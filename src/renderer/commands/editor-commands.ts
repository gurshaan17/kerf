import { useMemo } from 'react';
import type { Clip, TrackKind } from '@kerf/model';
import type { AnalysisKind } from '../../shared/contracts';
import { createMarker, createTrack } from '@kerf/model';
import { findClip, nextTrackOrder, sequenceDurationFrames } from '@kerf/engine';
import {
  deleteClipsCommand,
  duplicateClipsCommand,
  pasteClipsCommand,
  splitAtFrameCommand,
} from '../timeline/clip-commands';
import type { StudioState, StudioStore, StudioTool } from '../state/studio';
import { useStudioStoreApi } from '../state/StudioProvider';

interface ClipClipboard {
  readonly projectId: string;
  readonly clips: readonly Clip[];
}

let clipboard: ClipClipboard | null = null;

function nextTrackName(state: StudioState, kind: TrackKind): string {
  const tracks = state.snapshot?.project.sequence.tracks ?? [];
  const count = tracks.filter((track) => track.kind === kind).length + 1;
  switch (kind) {
    case 'video':
      return `Video ${count}`;
    case 'audio':
      return `Audio ${count}`;
    case 'caption':
      return count === 1 ? 'Captions' : `Captions ${count}`;
    case 'overlay':
      return `Overlay ${count}`;
  }
}

function selectedClips(state: StudioState): Clip[] {
  const sequence = state.snapshot?.project.sequence;
  if (!sequence) {
    return [];
  }
  return state.selection.clipIds.flatMap((id) => {
    const location = findClip(sequence, id);
    return location ? [location.clip] : [];
  });
}

export function hasClipboard(projectId?: string): boolean {
  return Boolean(
    clipboard && (!projectId || clipboard.projectId === projectId),
  );
}

function copySelected(store: StudioStore): void {
  const state = store.getState();
  const snapshot = state.snapshot;
  if (!snapshot) {
    return;
  }
  const clips = selectedClips(state);
  if (clips.length === 0) {
    state.pushToast({
      title: 'Nothing to copy',
      description: 'Select one or more clips first.',
      tone: 'warning',
    });
    return;
  }
  clipboard = { projectId: snapshot.project.id, clips };
  state.pushToast({
    title:
      clips.length === 1 ? '1 clip copied' : `${clips.length} clips copied`,
    description: 'Press ⌘V to paste at the playhead.',
    tone: 'info',
  });
}

async function pasteClipboard(store: StudioStore): Promise<void> {
  const state = store.getState();
  const snapshot = state.snapshot;
  if (!snapshot) {
    return;
  }
  if (!clipboard || clipboard.clips.length === 0) {
    state.pushToast({
      title: 'Nothing to paste',
      description: 'Copy clips from the timeline first.',
      tone: 'warning',
    });
    return;
  }
  if (clipboard.projectId !== snapshot.project.id) {
    state.pushToast({
      title: 'Clipboard belongs to another project',
      description: 'Copy clips again in this project.',
      tone: 'warning',
    });
    return;
  }
  const pasted = pasteClipsCommand(
    snapshot.project.sequence,
    clipboard.clips,
    state.playhead,
  );
  if (!pasted) {
    state.pushToast({
      title: 'Cannot paste here',
      description: 'Unlock a compatible track before pasting.',
      tone: 'warning',
    });
    return;
  }
  const result = await state.apply(pasted.command, 'Paste clips');
  if (!result) {
    return;
  }
  state.clearSelection();
  pasted.clipIds.forEach((id, index) => state.selectClip(id, index > 0));
}

function splitAtPlayhead(store: StudioStore): void {
  const state = store.getState();
  const sequence = state.snapshot?.project.sequence;
  if (!sequence) {
    return;
  }
  const command = splitAtFrameCommand(
    sequence,
    state.playhead,
    state.selection.clipIds,
  );
  if (command) {
    void state.apply(command, 'Split at playhead');
  }
}

function deleteSelected(store: StudioStore, ripple: boolean): void {
  const state = store.getState();
  const sequence = state.snapshot?.project.sequence;
  if (!sequence || state.selection.clipIds.length === 0) {
    return;
  }
  const command = deleteClipsCommand(sequence, state.selection.clipIds, ripple);
  if (command) {
    void state.apply(command, ripple ? 'Ripple delete' : 'Delete clips');
  }
}

function duplicateSelected(store: StudioStore): void {
  const state = store.getState();
  const sequence = state.snapshot?.project.sequence;
  if (!sequence || state.selection.clipIds.length === 0) {
    return;
  }
  const command = duplicateClipsCommand(sequence, state.selection.clipIds);
  if (command) {
    void state.apply(command, 'Duplicate clips');
  }
}

function selectAll(store: StudioStore): void {
  const state = store.getState();
  const sequence = state.snapshot?.project.sequence;
  if (!sequence) {
    return;
  }
  const ids = sequence.tracks.flatMap((track) =>
    track.clips.map((clip) => clip.id),
  );
  state.clearSelection();
  ids.forEach((id, index) => state.selectClip(id, index > 0));
}

function analyzeSelected(
  store: StudioStore,
  kinds: readonly AnalysisKind[],
): void {
  const state = store.getState();
  const clips = selectedClips(state);
  const clip = clips.find(
    (candidate) =>
      (candidate.type === 'video' || candidate.type === 'audio') &&
      candidate.assetId,
  );
  if (!clip || (clip.type !== 'video' && clip.type !== 'audio')) {
    state.pushToast({
      title: 'No source clip selected',
      description: 'Select a video or audio clip to analyse its source.',
      tone: 'warning',
    });
    return;
  }
  void state.analyze(clip.assetId, kinds);
}

function addMarker(store: StudioStore): void {
  const state = store.getState();
  const sequence = state.snapshot?.project.sequence;
  if (!sequence) {
    return;
  }
  const frame = Math.round(state.playhead);
  if (sequence.markers.some((marker) => marker.frame === frame)) {
    state.pushToast({
      title: 'Marker already exists',
      description: 'Move the playhead or edit the existing marker.',
      tone: 'warning',
    });
    return;
  }
  const marker = createMarker({
    frame,
    label: `Marker ${sequence.markers.length + 1}`,
  });
  void state.apply({ type: 'marker.add', marker }, 'Add marker');
}

function addTrack(store: StudioStore, kind: TrackKind): void {
  const state = store.getState();
  const sequence = state.snapshot?.project.sequence;
  if (!sequence) {
    return;
  }
  const track = createTrack({
    kind,
    name: nextTrackName(state, kind),
    order: nextTrackOrder(sequence),
  });
  void state.apply({ type: 'track.add', track }, 'Add track');
}

function goToEnd(store: StudioStore): void {
  const state = store.getState();
  const sequence = state.snapshot?.project.sequence;
  if (sequence) {
    state.setPlayhead(sequenceDurationFrames(sequence));
  }
}

function setTool(store: StudioStore, tool: StudioTool): void {
  const state = store.getState();
  state.setTool(tool);
}

export function useEditorCommands() {
  const store = useStudioStoreApi();

  return useMemo(
    () => ({
      split: () => splitAtPlayhead(store),
      deleteSelected: (ripple = false) => deleteSelected(store, ripple),
      duplicateSelected: () => duplicateSelected(store),
      copySelected: () => copySelected(store),
      pasteClipboard: () => pasteClipboard(store),
      hasClipboard: () => hasClipboard(store.getState().snapshot?.project.id),
      selectAll: () => selectAll(store),
      addMarker: () => addMarker(store),
      addTrack: (kind: TrackKind) => addTrack(store, kind),
      analyzeSelected: (kinds: readonly AnalysisKind[]) =>
        analyzeSelected(store, kinds),
      undo: () => store.getState().undo(),
      redo: () => store.getState().redo(),
      togglePlay: () => store.getState().togglePlaying(),
      goToStart: () => store.getState().setPlayhead(0),
      goToEnd: () => goToEnd(store),
      nudge: (frames: number) => store.getState().nudgePlayhead(frames),
      selectTool: (tool: StudioTool) => setTool(store, tool),
      toggleSnap: () => store.getState().toggleSnap(),
      toggleRipple: () => store.getState().toggleRipple(),
      zoomIn: () => store.getState().zoomBy(1.25),
      zoomOut: () => store.getState().zoomBy(1 / 1.25),
      importFootage: () => store.getState().importFootage(),
      closeProject: () => store.getState().closeProject(),
    }),
    [store],
  );
}
