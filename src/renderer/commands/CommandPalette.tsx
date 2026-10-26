import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AudioLines,
  Captions,
  Clapperboard,
  Copy,
  CopyPlus,
  FileVideo,
  Film,
  Flag,
  FolderOpen,
  Info,
  Keyboard,
  Magnet,
  MousePointer2,
  Music2,
  Palette,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  ScanLine,
  Search,
  Settings2,
  SkipBack,
  SkipForward,
  Trash2,
  Type,
  Undo2,
  Waves,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Dialog, Input, Kbd, cn } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';
import { useEditorCommands } from './editor-commands';

interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  readonly keywords?: string;
  readonly shortcut?: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  readonly run: () => void;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onShowShortcuts: () => void;
  readonly onExport: () => void;
  readonly onOpenSearch: () => void;
  readonly onOpenTranscript: (assetId: string) => void;
  readonly onOpenScenes: (assetId: string) => void;
  readonly onOpenBeats: (assetId: string) => void;
  readonly onOpenAnalysis: () => void;
  readonly onOpenMotion: () => void;
  readonly onOpenReferences: () => void;
  readonly onOpenAbout: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onShowShortcuts,
  onExport,
  onOpenSearch,
  onOpenTranscript,
  onOpenScenes,
  onOpenBeats,
  onOpenAnalysis,
  onOpenMotion,
  onOpenReferences,
  onOpenAbout,
}: CommandPaletteProps) {
  const commands = useEditorCommands();
  const snapshot = useStudio((state) => state.snapshot);
  const playing = useStudio((state) => state.playing);
  const snapEnabled = useStudio((state) => state.snapEnabled);
  const rippleEnabled = useStudio((state) => state.rippleEnabled);
  const selectedClipIds = useStudio((state) => state.selection.clipIds);
  const selectionCount = selectedClipIds.length;
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedAssetId = useMemo(() => {
    if (!snapshot || selectedClipIds.length === 0) {
      return null;
    }
    const selected = new Set(selectedClipIds);
    for (const track of snapshot.project.sequence.tracks) {
      for (const clip of track.clips) {
        if (
          selected.has(clip.id) &&
          (clip.type === 'video' || clip.type === 'audio')
        ) {
          return clip.assetId;
        }
      }
    }
    return null;
  }, [snapshot, selectedClipIds]);

  const transcriptTargetId = useMemo(() => {
    if (!snapshot || !selectedAssetId) {
      return null;
    }
    return snapshot.transcripts.some(
      (transcript) => transcript.assetId === selectedAssetId,
    )
      ? selectedAssetId
      : null;
  }, [snapshot, selectedAssetId]);

  const scenesTargetId = useMemo(() => {
    if (!snapshot || !selectedAssetId) {
      return null;
    }
    return snapshot.scenes.some((scene) => scene.assetId === selectedAssetId)
      ? selectedAssetId
      : null;
  }, [snapshot, selectedAssetId]);

  const beatsTargetId = useMemo(() => {
    if (!snapshot || !selectedAssetId) {
      return null;
    }
    return snapshot.beatMaps.some(
      (beatMap) => beatMap.assetId === selectedAssetId,
    )
      ? selectedAssetId
      : null;
  }, [snapshot, selectedAssetId]);

  const commandList = useMemo<PaletteCommand[]>(() => {
    const hasSelection = selectionCount > 0;
    const canUndo = snapshot?.history.canUndo ?? false;
    const canRedo = snapshot?.history.canRedo ?? false;
    const hasSequence = Boolean(snapshot);
    const canPaste = commands.hasClipboard();

    return [
      {
        id: 'transport.play',
        label: playing ? 'Pause' : 'Play',
        keywords: 'transport playback',
        shortcut: 'Space',
        icon: playing ? <Pause size={14} /> : <Play size={14} />,
        disabled: !hasSequence,
        run: commands.togglePlay,
      },
      {
        id: 'transport.start',
        label: 'Go to start',
        keywords: 'playhead beginning first',
        shortcut: 'Home',
        icon: <SkipBack size={14} />,
        disabled: !hasSequence,
        run: commands.goToStart,
      },
      {
        id: 'transport.end',
        label: 'Go to end',
        keywords: 'playhead last finish',
        shortcut: 'End',
        icon: <SkipForward size={14} />,
        disabled: !hasSequence,
        run: commands.goToEnd,
      },
      {
        id: 'edit.undo',
        label: 'Undo',
        keywords: 'history back',
        shortcut: '⌘Z',
        icon: <Undo2 size={14} />,
        disabled: !canUndo,
        run: commands.undo,
      },
      {
        id: 'edit.redo',
        label: 'Redo',
        keywords: 'history forward',
        shortcut: '⇧⌘Z',
        icon: <Redo2 size={14} />,
        disabled: !canRedo,
        run: commands.redo,
      },
      {
        id: 'edit.split',
        label: 'Split at playhead',
        keywords: 'blade cut razor',
        shortcut: '⌘B',
        icon: <Scissors size={14} />,
        disabled: !hasSequence,
        run: commands.split,
      },
      {
        id: 'edit.copy',
        label: 'Copy selected clips',
        keywords: 'clipboard duplicate',
        shortcut: '⌘C',
        icon: <Copy size={14} />,
        disabled: !hasSelection,
        run: commands.copySelected,
      },
      {
        id: 'edit.paste',
        label: 'Paste at playhead',
        keywords: 'clipboard',
        shortcut: '⌘V',
        icon: <CopyPlus size={14} />,
        disabled: !canPaste,
        run: () => void commands.pasteClipboard(),
      },
      {
        id: 'edit.duplicate',
        label: 'Duplicate selected clips',
        keywords: 'copy repeat',
        shortcut: '⌘D',
        icon: <CopyPlus size={14} />,
        disabled: !hasSelection,
        run: commands.duplicateSelected,
      },
      {
        id: 'edit.selectAll',
        label: 'Select all clips',
        keywords: 'selection',
        shortcut: '⌘A',
        icon: <MousePointer2 size={14} />,
        disabled: !hasSequence,
        run: commands.selectAll,
      },
      {
        id: 'edit.delete',
        label: 'Delete selected clips',
        keywords: 'remove',
        shortcut: '⌫',
        icon: <Trash2 size={14} />,
        disabled: !hasSelection,
        run: () => commands.deleteSelected(false),
      },
      {
        id: 'edit.rippleDelete',
        label: 'Ripple delete selected clips',
        keywords: 'remove close gap',
        shortcut: '⇧⌫',
        icon: <Waves size={14} />,
        disabled: !hasSelection,
        run: () => commands.deleteSelected(true),
      },
      {
        id: 'marker.add',
        label: 'Add marker at playhead',
        keywords: 'flag',
        shortcut: 'M',
        icon: <Flag size={14} />,
        disabled: !hasSequence,
        run: commands.addMarker,
      },
      {
        id: 'track.video',
        label: 'Add video track',
        keywords: 'lane',
        icon: <Film size={14} />,
        disabled: !hasSequence,
        run: () => commands.addTrack('video'),
      },
      {
        id: 'track.audio',
        label: 'Add audio track',
        keywords: 'lane sound',
        icon: <AudioLines size={14} />,
        disabled: !hasSequence,
        run: () => commands.addTrack('audio'),
      },
      {
        id: 'track.caption',
        label: 'Add caption track',
        keywords: 'lane subtitles text',
        icon: <Type size={14} />,
        disabled: !hasSequence,
        run: () => commands.addTrack('caption'),
      },
      {
        id: 'tool.select',
        label: 'Use select tool',
        keywords: 'pointer',
        shortcut: 'V',
        icon: <MousePointer2 size={14} />,
        run: () => commands.selectTool('select'),
      },
      {
        id: 'tool.blade',
        label: 'Use blade tool',
        keywords: 'cut split razor',
        shortcut: 'B',
        icon: <Scissors size={14} />,
        run: () => commands.selectTool('blade'),
      },
      {
        id: 'tool.text',
        label: 'Use text tool',
        keywords: 'title caption',
        shortcut: 'T',
        icon: <Type size={14} />,
        run: () => commands.selectTool('text'),
      },
      {
        id: 'view.snap',
        label: snapEnabled ? 'Turn snapping off' : 'Turn snapping on',
        keywords: 'magnet align',
        shortcut: 'N',
        icon: <Magnet size={14} />,
        run: commands.toggleSnap,
      },
      {
        id: 'view.ripple',
        label: rippleEnabled ? 'Turn ripple off' : 'Turn ripple on',
        keywords: 'magnetic delete gaps',
        shortcut: 'R',
        icon: <Waves size={14} />,
        run: commands.toggleRipple,
      },
      {
        id: 'view.zoomIn',
        label: 'Zoom in',
        keywords: 'timeline scale',
        shortcut: '⌘+',
        icon: <ZoomIn size={14} />,
        run: commands.zoomIn,
      },
      {
        id: 'view.zoomOut',
        label: 'Zoom out',
        keywords: 'timeline scale',
        shortcut: '⌘−',
        icon: <ZoomOut size={14} />,
        run: commands.zoomOut,
      },
      {
        id: 'analysis.search',
        label: 'Search transcripts and scenes',
        keywords: 'find words shots descriptions',
        icon: <Search size={14} />,
        disabled: !hasSequence,
        run: onOpenSearch,
      },
      {
        id: 'analysis.transcript',
        label: 'View transcript',
        keywords: 'words speech read verify captions source',
        icon: <Captions size={14} />,
        disabled: !transcriptTargetId,
        run: () => {
          if (transcriptTargetId) {
            onOpenTranscript(transcriptTargetId);
          }
        },
      },
      {
        id: 'analysis.scenes.view',
        label: 'View scenes',
        keywords: 'storyboard shots cuts keyframes thumbnails',
        icon: <ScanLine size={14} />,
        disabled: !scenesTargetId,
        run: () => {
          if (scenesTargetId) {
            onOpenScenes(scenesTargetId);
          }
        },
      },
      {
        id: 'analysis.beats.view',
        label: 'View beats',
        keywords: 'tempo bpm rhythm music grid markers',
        icon: <Music2 size={14} />,
        disabled: !beatsTargetId,
        run: () => {
          if (beatsTargetId) {
            onOpenBeats(beatsTargetId);
          }
        },
      },
      {
        id: 'analysis.settings',
        label: 'Analysis settings',
        keywords: 'whisper transcribe provider key vision consent models',
        icon: <Settings2 size={14} />,
        run: onOpenAnalysis,
      },
      {
        id: 'analysis.scenes',
        label: 'Detect scenes for selected asset',
        keywords: 'shots cuts keyframes',
        icon: <ScanLine size={14} />,
        disabled: !hasSequence,
        run: () => void commands.analyzeSelected(['scenes']),
      },
      {
        id: 'reference.open',
        label: 'References',
        keywords: 'look grade palette rhythm pacing style transfer',
        icon: <Palette size={14} />,
        disabled: !hasSequence,
        run: onOpenReferences,
      },
      {
        id: 'motion.open',
        label: 'Compositions',
        keywords: 'motion scene tree sandbox title lower third',
        icon: <Clapperboard size={14} />,
        disabled: !hasSequence,
        run: onOpenMotion,
      },
      {
        id: 'file.import',
        label: 'Import footage',
        keywords: 'media file video audio image',
        shortcut: '⌘I',
        icon: <Plus size={14} />,
        disabled: !hasSequence,
        run: () => void commands.importFootage(),
      },
      {
        id: 'file.export',
        label: 'Export video',
        keywords: 'render mp4 encode output download',
        shortcut: '⌘E',
        icon: <FileVideo size={14} />,
        disabled: !hasSequence,
        run: onExport,
      },
      {
        id: 'file.shortcuts',
        label: 'Keyboard shortcuts',
        keywords: 'help keys reference',
        shortcut: '?',
        icon: <Keyboard size={14} />,
        run: onShowShortcuts,
      },
      {
        id: 'help.about',
        label: 'About Kerf',
        keywords: 'version licences local first electron',
        icon: <Info size={14} />,
        run: onOpenAbout,
      },
      {
        id: 'file.projects',
        label: 'Back to projects',
        keywords: 'close leave browser',
        icon: <FolderOpen size={14} />,
        disabled: !hasSequence,
        run: () => void commands.closeProject(),
      },
    ];
  }, [
    commands,
    onExport,
    onOpenAbout,
    onOpenAnalysis,
    onOpenMotion,
    onOpenReferences,
    onOpenSearch,
    onOpenTranscript,
    onOpenScenes,
    onOpenBeats,
    onShowShortcuts,
    open,
    playing,
    rippleEnabled,
    beatsTargetId,
    scenesTargetId,
    selectionCount,
    snapEnabled,
    snapshot,
    transcriptTargetId,
  ]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return commandList;
    }
    return commandList.filter((command) =>
      `${command.label} ${command.keywords ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [commandList, query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery('');
    setSelectedIndex(0);
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  useEffect(() => {
    commandRefs.current[selectedIndex]?.scrollIntoView({
      block: 'nearest',
    });
  }, [selectedIndex]);

  const runCommand = (command: PaletteCommand) => {
    if (command.disabled) {
      return;
    }
    onOpenChange(false);
    command.run();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search every timeline action. Arrow keys move, Enter runs."
    >
      <div className="k-palette">
        <div className="k-palette__search">
          <Search size={14} aria-hidden="true" />
          <Input
            ref={inputRef}
            value={query}
            aria-label="Search commands"
            placeholder="Type a command…"
            className="h-8 pl-8"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex((current) =>
                  filtered.length === 0 ? 0 : (current + 1) % filtered.length,
                );
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((current) =>
                  filtered.length === 0
                    ? 0
                    : (current - 1 + filtered.length) % filtered.length,
                );
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const command = filtered[selectedIndex];
                if (command) {
                  runCommand(command);
                }
              }
            }}
          />
        </div>

        <div className="k-palette__list" role="listbox" aria-label="Commands">
          {filtered.length === 0 ? (
            <p className="k-palette__empty">No matching commands.</p>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                ref={(node) => {
                  commandRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                tabIndex={-1}
                disabled={command.disabled}
                className={cn(
                  'k-palette__item',
                  index === selectedIndex && 'is-selected',
                )}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => runCommand(command)}
              >
                <span className="k-palette__icon">{command.icon}</span>
                <span className="k-palette__label">{command.label}</span>
                {command.shortcut ? (
                  <Kbd className="ml-auto">{command.shortcut}</Kbd>
                ) : null}
              </button>
            ))
          )}
        </div>

        <div className="k-palette__footer">
          <span>↑↓ Navigate</span>
          <span>↵ Run</span>
          <span>Esc Close</span>
        </div>
      </div>
    </Dialog>
  );
}
