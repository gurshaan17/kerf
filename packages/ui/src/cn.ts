import { twMerge } from 'tailwind-merge';
import { cx } from './cx';
import type { ClassValue } from './cx';

/** Join conditional classes and resolve Tailwind conflicts. */
export function cn(...values: ClassValue[]): string {
  return twMerge(cx(...values));
}
