import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import type { ProjectRepository } from '../projects';
import { isPathInside } from '../projects/paths';

export type MediaSlot =
  | 'source'
  | 'thumbnail'
  | 'proxy'
  | 'waveform'
  | 'filmstrip';

export type MediaRequest =
  | {
      readonly kind: 'asset';
      readonly assetId: string;
      readonly slot: MediaSlot;
    }
  | {
      readonly kind: 'project';
      readonly projectId: string;
      readonly relativePath: string;
    };

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

export function mimeForPath(filePath: string): string {
  return (
    MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  );
}

const SLOTS = new Set<MediaSlot>([
  'source',
  'thumbnail',
  'proxy',
  'waveform',
  'filmstrip',
]);

export function parseMediaRequest(rawUrl: string): MediaRequest | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'kerfmedia:') {
    return null;
  }

  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  if (url.host === 'asset' && segments.length === 2) {
    const assetId = segments[0];
    const slot = segments[1] as MediaSlot | undefined;
    if (!assetId || !slot || !SLOTS.has(slot)) {
      return null;
    }
    return { kind: 'asset', assetId, slot };
  }

  if (url.host === 'project' && segments.length >= 2) {
    const projectId = segments[0];
    const relativePath = segments.slice(1).join('/');
    if (!projectId || relativePath.length === 0) {
      return null;
    }
    return { kind: 'project', projectId, relativePath };
  }

  return null;
}

export interface MediaTarget {
  readonly filePath: string;
  readonly mimeType: string;
  readonly cacheControl: string;
}

function assetCachePath(
  slot: Exclude<MediaSlot, 'source'>,
  cache: {
    proxyPath: string | null;
    thumbnailPath: string | null;
    waveformPath: string | null;
    filmstripPath: string | null;
  },
): string | null {
  switch (slot) {
    case 'thumbnail':
      return cache.thumbnailPath;
    case 'proxy':
      return cache.proxyPath;
    case 'waveform':
      return cache.waveformPath;
    case 'filmstrip':
      return cache.filmstripPath;
  }
}

export function resolveMediaTarget(
  repository: ProjectRepository,
  request: MediaRequest,
): MediaTarget | null {
  if (request.kind === 'project') {
    const folder = repository.folderFor(request.projectId);
    if (!folder) {
      return null;
    }
    const filePath = join(folder, request.relativePath);
    if (!isPathInside(folder, filePath)) {
      return null;
    }
    return {
      filePath,
      mimeType: mimeForPath(filePath),
      cacheControl: 'private, max-age=60',
    };
  }

  const asset = repository.findAsset(request.assetId);
  if (!asset) {
    return null;
  }
  if (request.slot === 'source') {
    return {
      filePath: asset.sourcePath,
      mimeType: mimeForPath(asset.sourcePath),
      cacheControl: 'no-store',
    };
  }

  const filePath = assetCachePath(request.slot, asset.cache);
  if (!filePath) {
    return null;
  }
  const folder = repository.folderFor(asset.projectId);
  if (folder && !isPathInside(folder, filePath)) {
    return null;
  }
  return {
    filePath,
    mimeType: mimeForPath(filePath),
    cacheControl: 'private, max-age=3600',
  };
}

export type RangeResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'range'; readonly start: number; readonly end: number }
  | { readonly kind: 'invalid' };

export function parseRangeHeader(
  value: string | null,
  size: number,
): RangeResult {
  if (!value) {
    return { kind: 'none' };
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) {
    return { kind: 'invalid' };
  }
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (startText.length === 0 && endText.length === 0) {
    return { kind: 'invalid' };
  }

  let start: number;
  let end: number;
  if (startText.length === 0) {
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) {
      return { kind: 'invalid' };
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText.length === 0 ? size - 1 : Number(endText);
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return { kind: 'invalid' };
  }

  return { kind: 'range', start, end: Math.min(end, size - 1) };
}

async function resolveRealFile(target: MediaTarget): Promise<string | null> {
  try {
    const info = await stat(target.filePath);
    if (!info.isFile()) {
      return null;
    }
    return await realpath(target.filePath);
  } catch {
    return null;
  }
}

export async function serveMediaRequest(
  repository: ProjectRepository,
  rawUrl: string,
  request: Request,
): Promise<Response> {
  const parsed = parseMediaRequest(rawUrl);
  if (!parsed) {
    return new Response('Not found', { status: 404 });
  }
  const target = resolveMediaTarget(repository, parsed);
  if (!target) {
    return new Response('Not found', { status: 404 });
  }

  if (parsed.kind === 'project') {
    const folder = repository.folderFor(parsed.projectId);
    if (folder) {
      try {
        const root = await realpath(folder);
        const file = await realpath(target.filePath);
        if (!isPathInside(root, file)) {
          return new Response('Not found', { status: 404 });
        }
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }
  }

  const filePath = await resolveRealFile(target);
  if (!filePath) {
    return new Response('Not found', { status: 404 });
  }

  const info = await stat(filePath);
  const range = parseRangeHeader(request.headers.get('range'), info.size);
  if (range.kind === 'invalid') {
    return new Response('Range not satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${info.size}` },
    });
  }

  const headers = new Headers({
    'Content-Type': target.mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': target.cacheControl,
  });

  if (range.kind === 'range') {
    headers.set(
      'Content-Range',
      `bytes ${range.start}-${range.end}/${info.size}`,
    );
    headers.set('Content-Length', String(range.end - range.start + 1));
    if (request.method === 'HEAD') {
      return new Response(null, { status: 206, headers });
    }
    const stream = createReadStream(filePath, {
      start: range.start,
      end: range.end,
    });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers,
    });
  }

  headers.set('Content-Length', String(info.size));
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers,
  });
}
