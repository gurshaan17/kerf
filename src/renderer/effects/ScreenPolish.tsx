import { useState } from 'react';
import type { Sequence } from '@kerf/model';
import { screenPolishCommand, suggestScreenPolish } from '@kerf/engine';
import type { PolishFocus } from '@kerf/engine';
import { Button } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';

export function ScreenPolish({ sequence }: { sequence: Sequence }) {
  const [draft, setDraft] = useState<PolishFocus[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = useStudio((s) => s.apply);
  const seek = useStudio((s) => s.setPlayhead);
  const locked = sequence.tracks.some((t) => t.kind === 'effects' && t.locked);
  const update = (index: number, patch: Partial<PolishFocus>) =>
    setDraft((items) =>
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await apply(
        screenPolishCommand(sequence, draft),
        'Apply screen polish',
      );
      if (result) setDraft([]);
      else
        setError(
          'Polish was not applied. Check the project status and try again.',
        );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Screen polish">
      <div className="k-effects__section-title">Screen polish</div>
      <p className="k-inspector__hint">
        Suggest short zoom lenses at video clip starts. Review the focus and
        timing for each interaction; click detection is not available for
        imported footage.
      </p>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || locked}
        onClick={() => {
          const suggestions = suggestScreenPolish(sequence);
          setDraft(suggestions);
          setError(
            suggestions.length
              ? ''
              : 'No eligible video clips. Add video or remove its existing linked effects to suggest again.',
          );
        }}
      >
        Suggest polish
      </Button>
      {draft.map((item, index) => (
        <div className="k-effects__card" key={item.clipId}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => seek(item.startFrame)}
          >
            Review suggestion {index + 1}
          </Button>
          <label>
            Effect{' '}
            <select
              aria-label={`Effect ${index + 1}`}
              value={item.kind}
              onChange={(e) =>
                update(index, { kind: e.target.value as PolishFocus['kind'] })
              }
            >
              <option value="zoom">Zoom lens</option>
              <option value="spotlight">Spotlight</option>
              <option value="callout">Callout</option>
            </select>
          </label>
          {(['x', 'y'] as const).map((axis) => (
            <label key={axis}>
              Focus {axis.toUpperCase()} (%){' '}
              <input
                type="number"
                min="0"
                max="100"
                value={Math.round(item[axis] * 100)}
                onChange={(e) =>
                  update(index, { [axis]: e.target.valueAsNumber / 100 })
                }
              />
            </label>
          ))}
          <label>
            Start frame{' '}
            <input
              type="number"
              min="0"
              step="1"
              value={item.startFrame}
              onChange={(e) =>
                update(index, { startFrame: e.target.valueAsNumber })
              }
            />
          </label>
          <label>
            Duration (frames){' '}
            <input
              type="number"
              min="1"
              step="1"
              value={item.durationFrames}
              onChange={(e) =>
                update(index, { durationFrames: e.target.valueAsNumber })
              }
            />
          </label>
          {item.kind === 'callout' && (
            <label>
              Callout text{' '}
              <input
                value={item.text}
                onChange={(e) => update(index, { text: e.target.value })}
              />
            </label>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setDraft((items) => items.filter((_, i) => i !== index))
            }
          >
            Dismiss suggestion {index + 1}
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="k-inspector__hint">
          {error}
        </p>
      )}
      {draft.length > 0 && (
        <Button
          size="sm"
          disabled={busy || locked}
          onClick={() => void submit()}
        >
          {busy ? 'Applying…' : 'Apply screen polish'}
        </Button>
      )}
      {locked && (
        <p className="k-inspector__hint">
          Unlock the Effects track to apply polish.
        </p>
      )}
    </section>
  );
}
