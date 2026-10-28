import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type {
  FxOverlayClip,
  NormalizedPoint,
  NormalizedRegion,
} from '@kerf/model';
import { useStudio } from '../state/StudioProvider';

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type DragMode = 'move' | 'focus' | 'pointer' | ResizeHandle;

const MIN_SIZE = 0.02;
const HANDLES: readonly ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

interface DragState {
  readonly mode: DragMode;
  readonly startRegion: NormalizedRegion;
  readonly startPoint: NormalizedPoint;
  readonly startX: number;
  readonly startY: number;
  readonly width: number;
  readonly height: number;
  readonly region: NormalizedRegion;
  readonly point: NormalizedPoint;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function regionCentre(region: NormalizedRegion): NormalizedPoint {
  return {
    x: clamp(region.x + region.w / 2, 0, 1),
    y: clamp(region.y + region.h / 2, 0, 1),
  };
}

function moveRegion(
  region: NormalizedRegion,
  dx: number,
  dy: number,
): NormalizedRegion {
  return {
    x: clamp(region.x + dx, 0, 1 - region.w),
    y: clamp(region.y + dy, 0, 1 - region.h),
    w: region.w,
    h: region.h,
  };
}

function resizeRegion(
  region: NormalizedRegion,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): NormalizedRegion {
  let { x, y, w, h } = region;
  if (handle.includes('e')) {
    w = clamp(region.w + dx, MIN_SIZE, 1 - region.x);
  }
  if (handle.includes('s')) {
    h = clamp(region.h + dy, MIN_SIZE, 1 - region.y);
  }
  if (handle.includes('w')) {
    const right = region.x + region.w;
    x = clamp(region.x + dx, 0, right - MIN_SIZE);
    w = right - x;
  }
  if (handle.includes('n')) {
    const bottom = region.y + region.h;
    y = clamp(region.y + dy, 0, bottom - MIN_SIZE);
    h = bottom - y;
  }
  return { x, y, w, h };
}

function sameRegion(a: NormalizedRegion, b: NormalizedRegion): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function samePoint(a: NormalizedPoint, b: NormalizedPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Interactive handles live in an HTML layer above the preview canvas so they
 * can never leak into a rendered frame. Local drag state gives live feedback
 * and exactly one `clip.update` is dispatched when the pointer is released.
 */
export function OverlayControls({
  overlay,
}: {
  readonly overlay: FxOverlayClip;
}) {
  const apply = useStudio((state) => state.apply);
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const region = drag?.region ?? overlay.props.region;
  const focus =
    drag?.mode === 'focus'
      ? drag.point
      : overlay.props.kind === 'zoom'
        ? overlay.props.focus
        : null;
  const pointer =
    drag?.mode === 'pointer'
      ? drag.point
      : overlay.props.kind === 'callout'
        ? overlay.props.pointer
        : null;

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) {
        return;
      }
      event.preventDefault();
      const dx = (event.clientX - current.startX) / current.width;
      const dy = (event.clientY - current.startY) / current.height;
      const next: DragState =
        current.mode === 'focus' || current.mode === 'pointer'
          ? {
              ...current,
              point: {
                x: clamp(current.startPoint.x + dx, 0, 1),
                y: clamp(current.startPoint.y + dy, 0, 1),
              },
            }
          : {
              ...current,
              region:
                current.mode === 'move'
                  ? moveRegion(current.startRegion, dx, dy)
                  : resizeRegion(current.startRegion, current.mode, dx, dy),
            };
      dragRef.current = next;
      setDrag(next);
    };

    const finish = () => {
      const current = dragRef.current;
      if (!current) {
        return;
      }
      dragRef.current = null;
      setDrag(null);
      document.body.style.userSelect = '';
      if (current.mode === 'focus') {
        if (!samePoint(current.point, current.startPoint)) {
          void apply(
            {
              type: 'clip.update',
              clipId: overlay.id,
              patch: { props: { focus: current.point } },
            },
            'Move zoom focus',
          );
        }
        return;
      }
      if (current.mode === 'pointer') {
        if (!samePoint(current.point, current.startPoint)) {
          void apply(
            {
              type: 'clip.update',
              clipId: overlay.id,
              patch: { props: { pointer: current.point } },
            },
            'Move callout pointer',
          );
        }
        return;
      }
      if (!sameRegion(current.region, current.startRegion)) {
        void apply(
          {
            type: 'clip.update',
            clipId: overlay.id,
            patch: { props: { region: current.region } },
          },
          current.mode === 'move'
            ? 'Move overlay region'
            : 'Resize overlay region',
        );
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragRef.current) {
        return;
      }
      dragRef.current = null;
      setDrag(null);
      document.body.style.userSelect = '';
    };

    const onPointerUp = () => finish();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.userSelect = '';
    };
  }, [apply, overlay]);

  const begin = (event: ReactPointerEvent<HTMLElement>, mode: DragMode) => {
    if (event.button !== 0) {
      return;
    }
    const layer = layerRef.current;
    if (!layer) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const rect = layer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const startRegion = overlay.props.region;
    const centre = regionCentre(startRegion);
    const startPoint =
      mode === 'focus'
        ? (overlay.props.kind === 'zoom' && overlay.props.focus) || centre
        : mode === 'pointer'
          ? (overlay.props.kind === 'callout' && overlay.props.pointer) ||
            centre
          : centre;
    const next: DragState = {
      mode,
      startRegion,
      startPoint,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      region: startRegion,
      point: startPoint,
    };
    dragRef.current = next;
    setDrag(next);
    document.body.style.userSelect = 'none';
  };

  const kind = overlay.props.kind;
  const centre = regionCentre(region);
  const activePoint = kind === 'zoom' ? (focus ?? centre) : null;
  const calloutPointer = kind === 'callout' ? pointer : null;
  const hint =
    kind === 'zoom'
      ? 'Zoom · drag the focus dot'
      : kind === 'callout'
        ? pointer
          ? 'Callout · drag body, pointer or handles'
          : 'Callout · drag body or handles'
        : `${kind === 'blur' ? 'Blur' : 'Spotlight'} · drag body or handles`;

  return (
    <div
      ref={layerRef}
      className="k-overlay-controls"
      data-overlay-id={overlay.id}
    >
      <div
        className={
          drag
            ? 'k-overlay-controls__region is-dragging'
            : 'k-overlay-controls__region'
        }
        style={{
          left: `${region.x * 100}%`,
          top: `${region.y * 100}%`,
          width: `${region.w * 100}%`,
          height: `${region.h * 100}%`,
        }}
        onPointerDown={(event) => begin(event, 'move')}
      >
        {kind === 'callout' && calloutPointer ? (
          <svg
            className="k-overlay-controls__connector-svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line
              x1={50}
              y1={50}
              x2={((calloutPointer.x - region.x) / region.w) * 100}
              y2={((calloutPointer.y - region.y) / region.h) * 100}
            />
          </svg>
        ) : null}
        {HANDLES.map((handle) => (
          <span
            key={handle}
            className="k-overlay-controls__handle"
            data-handle={handle}
            aria-hidden="true"
            onPointerDown={(event) => begin(event, handle)}
          />
        ))}
      </div>

      {activePoint ? (
        <span
          className="k-overlay-controls__point"
          style={{
            left: `${activePoint.x * 100}%`,
            top: `${activePoint.y * 100}%`,
          }}
          role="button"
          tabIndex={0}
          title="Drag to move the zoom focus"
          onPointerDown={(event) => begin(event, 'focus')}
        />
      ) : null}

      {calloutPointer ? (
        <span
          className="k-overlay-controls__point"
          style={{
            left: `${calloutPointer.x * 100}%`,
            top: `${calloutPointer.y * 100}%`,
          }}
          role="button"
          tabIndex={0}
          title="Drag to move the callout pointer"
          onPointerDown={(event) => begin(event, 'pointer')}
        />
      ) : null}

      <span className="k-overlay-controls__hint">{hint}</span>
    </div>
  );
}
