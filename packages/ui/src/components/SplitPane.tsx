import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { cx } from '../cx';

export interface SplitPaneProps {
  primary: ReactNode;
  secondary: ReactNode;
  direction?: 'horizontal' | 'vertical';
  initial?: number;
  min?: number;
  max?: number;
  className?: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export function SplitPane({
  primary,
  secondary,
  direction = 'horizontal',
  initial = 50,
  min = 20,
  max = 80,
  className,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ start: number; size: number } | null>(null);
  const [size, setSize] = useState(() => clamp(initial, min, max));

  const isHorizontal = direction === 'horizontal';

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      start: isHorizontal ? event.clientX : event.clientY,
      size,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || !container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const extent = isHorizontal ? rect.width : rect.height;
    if (extent === 0) {
      return;
    }

    const position = isHorizontal ? event.clientX : event.clientY;
    setSize(
      clamp(drag.size + ((position - drag.start) / extent) * 100, min, max),
    );
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrease = isHorizontal ? 'ArrowLeft' : 'ArrowUp';
    const increase = isHorizontal ? 'ArrowRight' : 'ArrowDown';

    if (event.key === decrease) {
      event.preventDefault();
      setSize((current) => clamp(current - 2, min, max));
    } else if (event.key === increase) {
      event.preventDefault();
      setSize((current) => clamp(current + 2, min, max));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setSize(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      setSize(max);
    }
  };

  return (
    <div
      ref={containerRef}
      className={cx('k-split', `k-split--${direction}`, className)}
    >
      <div className="k-split__pane" style={{ flexBasis: `${size}%` }}>
        {primary}
      </div>
      <div
        className="k-split__handle"
        role="separator"
        aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(size)}
        aria-valuetext={`${Math.round(size)} percent`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onKeyDown={onKeyDown}
      />
      <div className="k-split__pane k-split__pane--secondary">{secondary}</div>
    </div>
  );
}
