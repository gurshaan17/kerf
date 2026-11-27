import { useEffect, useRef, useState } from 'react';
import type { Asset, AudibleClip } from '@kerf/model';
import { assetMediaUrl, cleanedAudioUrl } from '@kerf/canvas';
import { Button } from '@kerf/ui';
import type {
  NoiseReductionPreview,
  NoiseReductionRequest,
} from '../../shared/noise-reduction';
import { useStudio } from '../state/StudioProvider';

export function NoiseReductionControls({
  asset,
  clip,
}: {
  asset: Asset;
  clip: AudibleClip;
}) {
  const applyEdit = useStudio((state) => state.apply);
  const stopPlayback = useStudio((state) => state.setPlaying);
  const [strength, setStrength] = useState<NoiseReductionRequest['strength']>(
    clip.noiseReduction === 'strong' ? 'strong' : 'light',
  );
  const [preview, setPreview] = useState<NoiseReductionPreview | null>(null);
  const [original, setOriginal] = useState(false);
  const [operation, setOperation] = useState<'prepare' | 'apply' | null>(null);
  const [error, setError] = useState('');
  const request = useRef<string | null>(null);
  const position = useRef(0);
  const audio = useRef<HTMLAudioElement>(null);
  const bridge = window.kerf.noiseReduction;

  const discard = () => {
    if (request.current) void bridge?.cancel(request.current).catch(() => {});
    request.current = null;
    audio.current?.pause();
  };
  useEffect(() => discard, [bridge]);
  if (!bridge) return null;

  const prepare = async () => {
    discard();
    stopPlayback(false);
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setOperation('prepare');
    setPreview(null);
    setError('');
    try {
      const result = await bridge.prepare({
        requestId,
        clipId: clip.id,
        strength,
      });
      if (request.current !== requestId) return;
      position.current = result.startSeconds;
      setOriginal(false);
      setPreview(result);
    } catch (cause) {
      if (request.current === requestId)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request.current === requestId) setOperation(null);
    }
  };

  const apply = async () => {
    const id = request.current;
    if (!id || !preview || operation) return;
    audio.current?.pause();
    setOperation('apply');
    setError('');
    try {
      await bridge.apply(id);
      if (request.current === id) {
        request.current = null;
        setPreview(null);
      }
    } catch (cause) {
      if (request.current === id)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOperation(null);
    }
  };

  return (
    <div
      className="grid gap-2 rounded border border-line p-2"
      aria-label="Reduce background noise"
      role="group"
    >
      <p className="font-semibold text-ink">Reduce background noise</p>
      <label className="grid gap-1">
        Strength
        <select
          className="rounded border border-line bg-surface-2 p-1.5"
          value={strength}
          disabled={Boolean(operation)}
          onChange={(event) => {
            discard();
            setPreview(null);
            setError('');
            setStrength(event.target.value === 'strong' ? 'strong' : 'light');
          }}
        >
          <option value="light">Light</option>
          <option value="strong">Strong</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={Boolean(operation)}
          onClick={() => void prepare()}
        >
          {operation === 'prepare'
            ? 'Preparing cleaned audio…'
            : 'Preview noise reduction'}
        </Button>
        {operation === 'prepare' && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              discard();
              setOperation(null);
            }}
          >
            Cancel preview
          </Button>
        )}
        {clip.noiseReduction !== 'off' && (
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(operation)}
            onClick={() => {
              discard();
              setPreview(null);
              void applyEdit(
                {
                  type: 'clip.update',
                  clipId: clip.id,
                  patch: { noiseReduction: 'off' },
                },
                'Remove noise reduction',
              );
            }}
          >
            Remove noise reduction
          </Button>
        )}
      </div>
      {preview && (
        <>
          <div
            className="flex gap-2"
            role="group"
            aria-label="Compare noise reduction"
          >
            {(['Original', 'Cleaned'] as const).map((label) => (
              <Button
                key={label}
                size="sm"
                variant="secondary"
                aria-pressed={original === (label === 'Original')}
                disabled={operation === 'apply'}
                onClick={() => {
                  if (original === (label === 'Original')) return;
                  if (audio.current?.readyState)
                    position.current = audio.current.currentTime;
                  audio.current?.pause();
                  setOriginal(label === 'Original');
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <audio
            ref={audio}
            controls
            preload="auto"
            aria-label={original ? 'Original audio' : 'Cleaned audio'}
            className="w-full min-w-0"
            src={
              original
                ? assetMediaUrl(asset, 'source')
                : cleanedAudioUrl(asset, strength)
            }
            onLoadedMetadata={(event) => {
              event.currentTarget.currentTime = Math.min(
                preview.endSeconds,
                Math.max(preview.startSeconds, position.current),
              );
            }}
            onPlay={(event) => {
              stopPlayback(false);
              const media = event.currentTarget;
              if (
                media.currentTime < preview.startSeconds ||
                media.currentTime >= preview.endSeconds - 0.001
              )
                media.currentTime = preview.startSeconds;
            }}
            onTimeUpdate={(event) => {
              const media = event.currentTarget;
              if (media.currentTime >= preview.endSeconds) media.pause();
            }}
            onSeeking={(event) => {
              const media = event.currentTarget;
              if (
                media.currentTime < preview.startSeconds ||
                media.currentTime > preview.endSeconds
              )
                media.currentTime = Math.min(
                  preview.endSeconds,
                  Math.max(preview.startSeconds, media.currentTime),
                );
            }}
            onError={() => setError('Could not play this audio preview.')}
          />
          <Button
            size="sm"
            disabled={Boolean(operation)}
            onClick={() => void apply()}
          >
            Apply noise reduction
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
