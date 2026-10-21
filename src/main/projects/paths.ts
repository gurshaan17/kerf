import { mkdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const PROJECT_SUBDIRECTORIES = [
  'assets',
  'analysis',
  'cache',
  join('cache', 'proxies'),
  join('cache', 'thumbnails'),
  join('cache', 'waveforms'),
  'exports',
] as const;

export function slugifyProjectName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? slug : 'project';
}

export function projectFolderName(name: string, id: string): string {
  return `${slugifyProjectName(name)}-${id}`;
}

export function ensureProjectFolders(folderPath: string): void {
  for (const directory of PROJECT_SUBDIRECTORIES) {
    mkdirSync(join(folderPath, directory), { recursive: true });
  }
}

/** True when `child` is strictly inside `parent`, never equal to it. */
export function isPathInside(parent: string, child: string): boolean {
  const offset = relative(resolve(parent), resolve(child));
  return offset.length > 0 && !offset.startsWith('..') && !isAbsolute(offset);
}
