import { useRef, useState } from 'react';
import { Film, Captions, Crop as CropIcon, ArrowUpRight } from 'lucide-react';
import { Button, Dialog } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';
import { gamingCommand } from './gaming';
import type { Crop } from './gaming';
import demo from '../../../assets/blueprints/gaming-reference.mp4?url';
import './gaming.css';

export function RecipesDialog({
  open,
  onOpenChange,
  initialAssetId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAssetId?: string;
}) {
  const snapshot = useStudio((s) => s.snapshot);
  const selection = useStudio((s) => s.selection);
  const apply = useStudio((s) => s.apply);
  const importFootage = useStudio((s) => s.importFootage);
  const [chosen, setChosen] = useState('');
  const [webcam, setWebcam] = useState(false);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [captions, setCaptions] = useState(false);
  const [placement, setPlacement] = useState<'replace' | 'add'>('add');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const drag = useRef<{ x: number; y: number } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const selectedClip = snapshot?.project.sequence.tracks
    .flatMap((t) => t.clips)
    .find((c) => selection.clipIds.includes(c.id) && c.type === 'video');
  const selectedVideo = selectedClip?.type === 'video' ? selectedClip : null;
  const sourceId = chosen || initialAssetId || selectedVideo?.assetId || '';
  const source = snapshot?.assets.find(
    (a) => a.id === sourceId && a.kind === 'video',
  );
  const transcript = snapshot?.transcripts.find(
    (t) => t.assetId === sourceId && t.source !== 'visual',
  );
  const useSelected = selectedVideo?.assetId === sourceId;
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    };
  };
  const remix = async () => {
    if (!snapshot || !source) return;
    setWorking(true);
    setError('');
    try {
      if (useSelected && selectedVideo.timeMap.length)
        throw new Error(
          'Choose a clip without speed ramps for this Blueprint.',
        );
      if (webcam && !crop)
        throw new Error('Draw a rectangle around the webcam first.');
      const fps =
        snapshot.project.sequence.frameRate.numerator /
        snapshot.project.sequence.frameRate.denominator;
      const command = gamingCommand(
        snapshot.project.sequence,
        source,
        {
          sourceIn: useSelected ? selectedVideo.sourceInFrame : 0,
          duration: useSelected
            ? selectedVideo.durationFrames
            : Math.max(1, Math.floor(source.durationSeconds * fps)),
          speed: useSelected ? selectedVideo.speed : 1,
        },
        webcam ? crop : null,
        captions,
        transcript,
        placement,
      );
      const result = await apply(command);
      if (result) onOpenChange(false);
      else
        setError(
          'The edit could not be applied. Check the project error and try again.',
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  };
  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Gaming shorts"
      size="workspace"
      description="Turn your stream clip into a vertical short."
      panelClassName="gaming-blueprint"
    >
      <div className="gaming-layout">
        <section className="gaming-demo" aria-label="Blueprint reference">
          <video src={demo} controls playsInline preload="metadata" />
          <p>iShowSpeed Thinks He Beat GTA 5, Then Checks the Stats 😭</p>
          <span>41 sec · 9:16 · Reels & Shorts</span>
        </section>
        <section className="gaming-config" aria-label="Blueprint settings">
          <div>
            <h3>Stream to short</h3>
            <p>
              Amplify your webcam above the gameplay. Add captions at the center
              of the frame.
            </p>
          </div>
          <label>
            Choose a gaming clip
            <select
              value={sourceId}
              disabled={working}
              onChange={(e) => {
                setChosen(e.target.value);
                setCrop(null);
                setError('');
              }}
            >
              <option value="">Select imported video…</option>
              {snapshot?.assets
                .filter((a) => a.kind === 'video' && a.status === 'ready')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Film size={14} />}
            onClick={() => void importFootage()}
          >
            Import video
          </Button>
          {source && (
            <p className="gaming-note">
              {useSelected
                ? 'Uses the selected timeline clip’s trim.'
                : 'Uses the full source video.'}
            </p>
          )}
          <label className="gaming-toggle">
            <span>
              <CropIcon size={16} /> Enlarge webcam
            </span>
            <input
              type="checkbox"
              checked={webcam}
              onChange={(e) => setWebcam(e.target.checked)}
              disabled={working}
            />
          </label>
          {source && webcam && (
            <div>
              <p className="gaming-note">
                Pause on a clear frame, then drag around the webcam. Turn this
                off for gameplay-only footage.
              </p>
              <div
                className="gaming-source"
                style={{
                  aspectRatio: `${source.width || 16}/${source.height || 9}`,
                }}
                onPointerDown={(e) => {
                  if (working) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = point(e);
                  video.current?.pause();
                }}
                onPointerMove={(e) => {
                  if (!drag.current) return;
                  const end = point(e);
                  setCrop({
                    x: Math.min(end.x, drag.current.x),
                    y: Math.min(end.y, drag.current.y),
                    width: Math.abs(end.x - drag.current.x),
                    height: Math.abs(end.y - drag.current.y),
                  });
                }}
                onPointerUp={() => {
                  drag.current = null;
                  if (crop && (crop.width < 0.02 || crop.height < 0.02))
                    setCrop(null);
                }}
              >
                <video
                  key={source.id}
                  ref={video}
                  src={`kerfmedia://asset/${encodeURIComponent(source.id)}/source`}
                  muted
                  preload="metadata"
                />
                {crop && (
                  <div
                    className="gaming-crop"
                    style={{
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.width * 100}%`,
                      height: `${crop.height * 100}%`,
                    }}
                  />
                )}
              </div>
              <label className="gaming-scrub">
                Source frame
                <input
                  aria-label="Source preview time"
                  type="range"
                  min={0}
                  max={Math.max(0, source.durationSeconds - 0.1)}
                  step={0.1}
                  defaultValue={0}
                  onChange={(e) => {
                    if (video.current)
                      video.current.currentTime = Number(e.target.value);
                  }}
                />
              </label>
              <Button size="sm" variant="ghost" onClick={() => setCrop(null)}>
                Reset crop
              </Button>
            </div>
          )}
          <label className="gaming-toggle">
            <span>
              <Captions size={16} /> Center captions
            </span>
            <input
              type="checkbox"
              checked={captions}
              onChange={(e) => setCaptions(e.target.checked)}
              disabled={working}
            />
          </label>
          {captions && !transcript && (
            <div className="gaming-note">
              Transcribe this source to enable timed captions.
              <Button
                size="sm"
                variant="secondary"
                disabled={!source || working}
                onClick={async () => {
                  if (!source) return;
                  setWorking(true);
                  try {
                    await window.kerf.analysis.run({
                      assetId: source.id,
                      kinds: ['transcript'],
                    });
                    setError('Transcription started. Apply when it finishes.');
                  } catch (cause) {
                    setError(String(cause));
                  } finally {
                    setWorking(false);
                  }
                }}
              >
                Transcribe source
              </Button>
            </div>
          )}
          <label>
            Place the edit
            <select
              value={placement}
              disabled={working}
              onChange={(e) =>
                setPlacement(e.target.value as 'add' | 'replace')
              }
            >
              <option value="add">Add to end of timeline</option>
              <option value="replace">Replace current timeline</option>
            </select>
          </label>
          <p className="gaming-note">
            Sets the project to 1080 × 1920.{' '}
            {placement === 'add'
              ? 'Existing clips keep their timing; the canvas becomes vertical.'
              : 'Replaces existing tracks.'}{' '}
            Undo restores the previous edit.
          </p>
          {error && (
            <p role="alert" className="gaming-error">
              {error}
            </p>
          )}
          <Button
            variant="primary"
            leadingIcon={<ArrowUpRight size={16} />}
            disabled={
              !source ||
              working ||
              (captions && !transcript) ||
              (webcam && !crop)
            }
            onClick={() => void remix()}
          >
            {working ? 'Working…' : 'Apply Blueprint'}
          </Button>
        </section>
      </div>
    </Dialog>
  );
}
