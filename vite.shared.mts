import { fileURLToPath } from 'node:url';

const entry = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/** Workspace source aliases shared by every Vite process. */
export const kerfAliases: Record<string, string> = {
  '@kerf/model': entry('model'),
  '@kerf/engine': entry('engine'),
  '@kerf/canvas': entry('canvas'),
  '@kerf/motion': entry('motion'),
  '@kerf/tools': entry('tools'),
  '@kerf/agent': entry('agent'),
  '@kerf/ui': entry('ui'),
};
