import type { ImgHTMLAttributes } from 'react';
import logoUrl from './kerf-logo.svg?url';
import { cx } from '../cx';

export interface KerfMarkProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src'
> {
  size?: number;
}

/**
 * Kerf's brand tile: a gold plate split by the diagonal saw kerf. The artwork
 * is a multi-tone illustration, so it is rendered as an image rather than a
 * `currentColor` SVG.
 */
export function KerfMark({
  size = 22,
  className,
  alt = '',
  style,
  ...rest
}: KerfMarkProps) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt={alt}
      draggable={false}
      aria-hidden={alt ? undefined : true}
      className={cx('k-mark', className)}
      style={{ objectFit: 'cover', borderRadius: '9%', ...style }}
      {...rest}
    />
  );
}
