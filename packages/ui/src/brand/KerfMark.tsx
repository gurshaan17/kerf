import type { SVGProps } from 'react';
import { cx } from '../cx';

export interface KerfMarkProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * A saw-cut monogram: a K cut into a rounded plate, with the kerf running
 * through the upper corner.
 */
export function KerfMark({ size = 22, className, ...rest }: KerfMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      focusable="false"
      aria-hidden="true"
      className={cx('k-mark', className)}
      {...rest}
    >
      <rect
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        rx="4.5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M7.5 7v10M7.5 12l5.5-5M7.5 12l5.5 5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.5 4.25 19.75 7.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}
