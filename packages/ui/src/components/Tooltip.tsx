import { cloneElement, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../cn';

export interface TooltipProps {
  label: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const bubbleBaseClasses =
  'pointer-events-none fixed z-[var(--k-z-toast)] max-w-[calc(100vw-16px)] rounded-xs border border-line-strong bg-surface-raised px-[7px] py-1 text-[11px] leading-[1.3] text-ink shadow-1';

export function Tooltip({
  label,
  children,
  side = 'top',
  className,
}: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      if (!triggerRef.current || !bubbleRef.current) return;
      const anchor = triggerRef.current.getBoundingClientRect();
      const bubble = bubbleRef.current.getBoundingClientRect();
      const gap = 6;
      const margin = 8;
      let left = anchor.left + (anchor.width - bubble.width) / 2;
      let top = anchor.top - bubble.height - gap;
      if (side === 'bottom') top = anchor.bottom + gap;
      if (side === 'left' || side === 'right') {
        left =
          side === 'left'
            ? anchor.left - bubble.width - gap
            : anchor.right + gap;
        top = anchor.top + (anchor.height - bubble.height) / 2;
      }
      if (side === 'top' && top < margin) top = anchor.bottom + gap;
      if (side === 'bottom' && top + bubble.height > innerHeight - margin)
        top = anchor.top - bubble.height - gap;
      setPosition({
        left: Math.max(
          margin,
          Math.min(left, innerWidth - bubble.width - margin),
        ),
        top: Math.max(
          margin,
          Math.min(top, innerHeight - bubble.height - margin),
        ),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = new ResizeObserver(update);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (bubbleRef.current) observer.observe(bubbleRef.current);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer.disconnect();
    };
  }, [open, side, label]);
  const describedBy = [children.props['aria-describedby'], id]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      ref={triggerRef}
      className={cn('relative inline-flex', className)}
      data-side={side}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={(event) => setFocused(event.target.matches(':focus-visible'))}
      onBlur={() => setFocused(false)}
    >
      {cloneElement(children, { 'aria-describedby': describedBy })}
      {createPortal(
        <span
          ref={bubbleRef}
          id={id}
          role="tooltip"
          className={bubbleBaseClasses}
          style={{
            ...position,
            visibility: open && position ? 'visible' : 'hidden',
          }}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  );
}
