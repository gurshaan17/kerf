import { cn } from '../cn';

export interface SkeletonProps {
  className?: string;
}

/**
 * A neutral placeholder for content that is still loading. It is decorative,
 * so the surrounding region owns the accessible busy state.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block animate-pulse rounded-sm bg-surface-3/80',
        className,
      )}
    />
  );
}
