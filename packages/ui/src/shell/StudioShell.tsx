import { useState } from 'react';
import {
  AudioLines,
  Film,
  FolderOpen,
  Keyboard,
  Library,
  Magnet,
  MessageSquare,
  MoreHorizontal,
  MousePointer2,
  Music2,
  Pause,
  Play,
  Redo2,
  Scissors,
  Settings,
  SkipBack,
  SkipForward,
  Sparkles,
  Type,
  Undo2,
  Volume2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cx } from '../cx';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Field, Input } from '../components/Field';
import { IconButton } from '../components/IconButton';
import { Kbd, KbdGroup } from '../components/Kbd';
import { Panel } from '../components/Panel';
import { Select } from '../components/Select';
import { SplitPane } from '../components/SplitPane';
import { Tabs } from '../components/Tabs';
import { ToastViewport, useToastQueue } from '../components/Toast';

export interface StudioShellProps {
  projectName?: string;
  sequenceLabel?: string;
}

type TrackKind = 'video' | 'audio';

interface ClipBar {
  id: string;
  label: string;
  start: number;
  width: number;
  kind: TrackKind;
}

interface TrackRow {
  id: string;
  name: string;
  kind: TrackKind;
  clips: ClipBar[];
}

const TRACKS: TrackRow[] = [
  {
    id: 'v1',
    name: 'Video 1',
    kind: 'video',
    clips: [
      { id: 'c1', label: 'Opening shot', start: 2, width: 28, kind: 'video' },
      {
        id: 'c2',
        label: 'Insert — hands',
        start: 34,
        width: 15,
        kind: 'video',
      },
      { id: 'c3', label: 'Wide, dusk', start: 53, width: 27, kind: 'video' },
    ],
  },
  {
    id: 'a1',
    name: 'Audio 1',
    kind: 'audio',
    clips: [
      { id: 'c4', label: 'Room tone', start: 0, width: 52, kind: 'audio' },
      { id: 'c5', label: 'Music bed', start: 58, width: 38, kind: 'audio' },
    ],
  },
  {
    id: 'a2',
    name: 'Audio 2',
    kind: 'audio',
    clips: [
      {
        id: 'c6',
        label: 'Voiceover take 3',
        start: 18,
        width: 44,
        kind: 'audio',
      },
    ],
  },
];

const RULER_TICKS = ['00:00', '00:10', '00:20', '00:30', '00:40'];

function Stage() {
  const [playing, setPlaying] = useState(false);

  return (
    <section className="k-stage" aria-label="Preview">
      <header className="k-stage__head">
        <div>
          <p className="k-eyebrow">Preview</p>
          <h2 className="k-stage__title">Opening sequence</h2>
        </div>
        <span className="k-badge">Fit</span>
      </header>

      <div className="k-stage__viewport">
        <div className="k-stage__canvas" aria-label="Empty preview canvas">
          <div className="k-stage__safe" aria-hidden="true" />
          <div className="k-stage__empty">
            <Play size={26} aria-hidden="true" />
            <p>Drop footage to begin</p>
          </div>
        </div>
      </div>

      <div className="k-stage__transport">
        <div className="k-transport__group">
          <IconButton
            label="Go to start"
            size="sm"
            icon={<SkipBack size={14} />}
          />
          <IconButton
            label={playing ? 'Pause' : 'Play'}
            size="sm"
            icon={playing ? <Pause size={14} /> : <Play size={14} />}
            onClick={() => setPlaying((value) => !value)}
          />
          <IconButton
            label="Go to end"
            size="sm"
            icon={<SkipForward size={14} />}
          />
        </div>
        <span className="k-timecode">00:00:00:00</span>
        <span className="k-stage__duration">/ 00:00:40:00</span>
        <span className="k-transport__spacer" />
        <div className="k-transport__group">
          <IconButton label="Mute" size="sm" icon={<Volume2 size={14} />} />
        </div>
      </div>
    </section>
  );
}

function Timeline() {
  const [tool, setTool] = useState('select');
  const [snap, setSnap] = useState(true);

  return (
    <section className="k-timeline" aria-label="Timeline">
      <div className="k-timeline__toolbar">
        <div className="k-timeline__tools">
          <IconButton
            label="Select tool"
            size="sm"
            tooltip="Select (V)"
            active={tool === 'select'}
            icon={<MousePointer2 size={14} />}
            onClick={() => setTool('select')}
          />
          <IconButton
            label="Blade tool"
            size="sm"
            tooltip="Blade (B)"
            active={tool === 'blade'}
            icon={<Scissors size={14} />}
            onClick={() => setTool('blade')}
          />
          <IconButton
            label="Text tool"
            size="sm"
            tooltip="Text (T)"
            active={tool === 'text'}
            icon={<Type size={14} />}
            onClick={() => setTool('text')}
          />
          <span className="k-timeline__divider" aria-hidden="true" />
          <IconButton
            label="Snapping"
            size="sm"
            tooltip={snap ? 'Snapping on (N)' : 'Snapping off (N)'}
            active={snap}
            icon={<Magnet size={14} />}
            onClick={() => setSnap((value) => !value)}
          />
        </div>

        <div className="k-timeline__tools">
          <IconButton
            label="Undo"
            size="sm"
            tooltip="Undo (⌘Z)"
            icon={<Undo2 size={14} />}
            disabled
          />
          <IconButton
            label="Redo"
            size="sm"
            tooltip="Redo (⇧⌘Z)"
            icon={<Redo2 size={14} />}
            disabled
          />
          <span className="k-timeline__divider" aria-hidden="true" />
          <IconButton label="Zoom out" size="sm" icon={<ZoomOut size={14} />} />
          <span className="k-timeline__zoom-label">100%</span>
          <IconButton label="Zoom in" size="sm" icon={<ZoomIn size={14} />} />
        </div>
      </div>

      <div className="k-timeline__scroll">
        <div className="k-timeline__grid">
          <div className="k-timeline__row k-timeline__row--ruler">
            <div className="k-timeline__corner" aria-hidden="true" />
            <div className="k-timeline__ruler" aria-hidden="true">
              {RULER_TICKS.map((tick, index) => (
                <span
                  key={tick}
                  className={cx(
                    'k-timeline__tick',
                    index === RULER_TICKS.length - 1 && 'is-last',
                  )}
                  style={{ left: `${index * 25}%` }}
                >
                  {tick}
                </span>
              ))}
              <span className="k-ruler-playhead" style={{ left: '38%' }} />
            </div>
          </div>

          {TRACKS.map((track) => (
            <div key={track.id} className="k-timeline__row">
              <div className="k-track-head">
                <span
                  className="k-track-head__dot"
                  data-kind={track.kind}
                  aria-hidden="true"
                />
                <span className="k-track-head__id">
                  {track.id.toUpperCase()}
                </span>
                <span className="k-track-head__name">{track.name}</span>
              </div>
              <div
                className="k-track-lane"
                role="list"
                aria-label={`${track.name} clips`}
              >
                {track.clips.map((clip) => (
                  <button
                    key={clip.id}
                    type="button"
                    role="listitem"
                    className={cx('k-clip', `k-clip--${clip.kind}`)}
                    style={{ left: `${clip.start}%`, width: `${clip.width}%` }}
                    title={clip.label}
                  >
                    {clip.label}
                  </button>
                ))}
                <span
                  className="k-lane-playhead"
                  style={{ left: '38%' }}
                  aria-hidden="true"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Inspector() {
  const [tab, setTab] = useState('video');
  const [blend, setBlend] = useState('normal');

  return (
    <Panel
      className="k-shell__panel"
      title="Inspector"
      subtitle="Opening shot"
      actions={
        <IconButton
          label="Inspector options"
          size="sm"
          icon={<MoreHorizontal size={15} />}
        />
      }
    >
      <Tabs
        label="Inspector sections"
        value={tab}
        onValueChange={setTab}
        items={[
          {
            id: 'video',
            label: 'Video',
            icon: <Film size={13} />,
          },
          {
            id: 'audio',
            label: 'Audio',
            icon: <AudioLines size={13} />,
          },
        ]}
      />

      {tab === 'video' ? (
        <div className="k-inspector__stack" role="tabpanel">
          <div className="k-field-row">
            <Field label="Position X">
              <Input defaultValue="0" inputMode="numeric" />
            </Field>
            <Field label="Position Y">
              <Input defaultValue="0" inputMode="numeric" />
            </Field>
          </div>
          <div className="k-field-row">
            <Field label="Scale">
              <Input defaultValue="100%" />
            </Field>
            <Field label="Rotation">
              <Input defaultValue="0°" />
            </Field>
          </div>
          <Field label="Opacity">
            <Input defaultValue="100%" />
          </Field>
          <Field label="Blend mode" hint="Applies to the selected clip.">
            <Select
              value={blend}
              onChange={(event) => setBlend(event.target.value)}
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'screen', label: 'Screen' },
                { value: 'multiply', label: 'Multiply' },
                { value: 'overlay', label: 'Overlay' },
              ]}
            />
          </Field>
          <div className="k-inspector__note">
            <Sparkles size={14} aria-hidden="true" />
            <p>Effects and keyframes arrive with the clip inspector.</p>
          </div>
        </div>
      ) : (
        <div className="k-inspector__stack" role="tabpanel">
          <Field label="Volume">
            <Input defaultValue="0 dB" />
          </Field>
          <div className="k-field-row">
            <Field label="Fade in">
              <Input defaultValue="0.0 s" />
            </Field>
            <Field label="Fade out">
              <Input defaultValue="0.0 s" />
            </Field>
          </div>
          <Field label="Channel" hint="Stereo mix from the source clip.">
            <Select
              defaultValue="stereo"
              options={[
                { value: 'stereo', label: 'Stereo' },
                { value: 'left', label: 'Left only' },
                { value: 'right', label: 'Right only' },
                { value: 'mono', label: 'Mono' },
              ]}
            />
          </Field>
          <div className="k-inspector__note">
            <Music2 size={14} aria-hidden="true" />
            <p>Ducking and loudness matching arrive with the audio tools.</p>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function StudioShell({
  projectName = 'Untitled sequence',
  sequenceLabel = '1920 × 1080 · 24 fps',
}: StudioShellProps) {
  const [rail, setRail] = useState('media');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { items, push, dismiss } = useToastQueue();
  const isMac =
    typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);

  const railItems = [
    { id: 'media', label: 'Media', icon: <Library size={18} /> },
    { id: 'motion', label: 'Motion', icon: <Sparkles size={18} /> },
    { id: 'chat', label: 'Assistant', icon: <MessageSquare size={18} /> },
  ];

  const shortcuts = [
    { label: 'Play or pause', keys: ['Space'] },
    { label: 'Split at playhead', keys: [isMac ? '⌘' : 'Ctrl', 'K'] },
    { label: 'Undo', keys: [isMac ? '⌘' : 'Ctrl', 'Z'] },
    { label: 'Command palette', keys: [isMac ? '⌘' : 'Ctrl', '⇧', 'P'] },
    { label: 'Nudge by one frame', keys: ['←', '→'] },
  ];

  return (
    <div className={cx('k-shell', isMac && 'k-shell--darwin')}>
      <header className="k-shell__titlebar">
        <div className="k-shell__brand">
          <span className="k-shell__brand-mark" aria-hidden="true">
            K
          </span>
          <span>Kerf</span>
        </div>

        <div className="k-shell__project">
          <span className="k-shell__project-name">{projectName}</span>
          <span className="k-shell__project-meta">{sequenceLabel}</span>
        </div>

        <div className="k-shell__title-actions">
          <IconButton
            label="Keyboard shortcuts"
            tooltip="Keyboard shortcuts"
            size="sm"
            icon={<Keyboard size={15} />}
            onClick={() => setShortcutsOpen(true)}
          />
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<FolderOpen size={14} />}
          >
            Open
          </Button>
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<Scissors size={14} />}
            onClick={() =>
              push({
                title: 'Export queued',
                description: 'Encoding arrives with the export pipeline.',
                tone: 'success',
              })
            }
          >
            Export
          </Button>
        </div>
      </header>

      <div className="k-shell__body">
        <nav className="k-shell__rail" aria-label="Workspace">
          <div className="k-shell__rail-group">
            {railItems.map((item) => (
              <IconButton
                key={item.id}
                label={item.label}
                tooltip={item.label}
                icon={item.icon}
                active={rail === item.id}
                onClick={() => setRail(item.id)}
              />
            ))}
          </div>
          <span className="k-shell__rail-spacer" />
          <IconButton
            label="Settings"
            tooltip="Settings"
            icon={<Settings size={18} />}
          />
        </nav>

        <main className="k-shell__center">
          <SplitPane
            direction="vertical"
            initial={62}
            min={42}
            max={80}
            primary={<Stage />}
            secondary={<Timeline />}
          />
        </main>

        <aside className="k-shell__inspector" aria-label="Inspector">
          <Inspector />
        </aside>
      </div>

      <Dialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        title="Keyboard shortcuts"
        description="A few ways to move without leaving the keyboard."
        footer={
          <Button variant="primary" onClick={() => setShortcutsOpen(false)}>
            Got it
          </Button>
        }
      >
        <dl className="k-shortcut-list">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.label} className="k-shortcut-list__row">
              <dt>{shortcut.label}</dt>
              <dd>
                <KbdGroup>
                  {shortcut.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </KbdGroup>
              </dd>
            </div>
          ))}
        </dl>
      </Dialog>

      <ToastViewport items={items} onDismiss={dismiss} />
    </div>
  );
}
