import type { Asset } from '@kerf/model';

export type MediaSlot = 'source' | 'proxy' | 'thumbnail';

/** Import quality for video assets. Images always use their source file. */
export type MediaQuality = 'proxy' | 'source';

function encoded(value: string): string {
  return encodeURIComponent(value);
}

export function assetMediaUrl(asset: Asset, slot: MediaSlot): string {
  return `kerfmedia://asset/${encoded(asset.id)}/${slot}`;
}

function proxyUrl(asset: Asset): string {
  return asset.cache.proxyPath
    ? assetMediaUrl(asset, 'proxy')
    : assetMediaUrl(asset, 'source');
}

function sourceUrl(asset: Asset): string {
  return assetMediaUrl(asset, 'source');
}

function visualAsset(asset: Asset): boolean {
  return (
    asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'other'
  );
}

interface ReadyMedia {
  readonly readyState?: number;
  readonly videoWidth?: number;
  readonly complete?: boolean;
  readonly naturalWidth?: number;
}

/**
 * Duck-types readiness so the compositor and the pool work with real DOM media
 * as well as the Node canvas images used by golden tests.
 */
export function mediaElementReady(
  element: HTMLVideoElement | HTMLImageElement | null | undefined,
): boolean {
  if (!element) {
    return false;
  }
  const media = element as unknown as ReadyMedia;
  if (typeof media.videoWidth === 'number') {
    return (media.readyState ?? 0) >= 2 && media.videoWidth > 0;
  }
  return Boolean(media.complete) && (media.naturalWidth ?? 0) > 0;
}

interface VideoSlots {
  proxy?: HTMLVideoElement;
  source?: HTMLVideoElement;
}

export interface MediaPoolOptions {
  /**
   * Slot created eagerly for each video. Preview uses `proxy`; export and
   * single-frame rendering use `source`. The other slot is created lazily.
   */
  readonly defaultQuality?: MediaQuality;
}

/**
 * Owns the detached media elements used by the canvas. The pool is shared by
 * preview and export so both paths draw from the same source and seek logic.
 */
export class MediaPool {
  private readonly assets = new Map<string, Asset>();
  private readonly videos = new Map<string, VideoSlots>();
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly listeners = new Set<() => void>();
  readonly defaultQuality: MediaQuality;
  private disposed = false;

  constructor(assets: readonly Asset[] = [], options: MediaPoolOptions = {}) {
    this.defaultQuality = options.defaultQuality ?? 'proxy';
    this.setAssets(assets);
  }

  setAssets(assets: readonly Asset[]): void {
    if (this.disposed) {
      return;
    }
    const next = new Map(assets.map((asset) => [asset.id, asset]));
    this.assets.clear();
    for (const [id, asset] of next) {
      this.assets.set(id, asset);
      if (!visualAsset(asset)) {
        continue;
      }
      if (asset.kind === 'video') {
        const slots = this.videos.get(id) ?? {};
        this.videos.set(id, slots);
        if (!slots[this.defaultQuality]) {
          this.createVideo(asset, this.defaultQuality);
        }
      } else if (!this.images.has(id)) {
        this.createImage(asset);
      }
    }
    for (const id of Array.from(this.videos.keys())) {
      if (!next.has(id as Asset['id'])) {
        this.removeVideo(id);
      }
    }
    for (const id of Array.from(this.images.keys())) {
      if (!next.has(id as Asset['id'])) {
        this.removeImage(id);
      }
    }
  }

  private createVideo(asset: Asset, quality: MediaQuality): void {
    const slots = this.videos.get(asset.id) ?? {};
    this.videos.set(asset.id, slots);

    // Without a proxy the two qualities are the same file; sharing one element
    // avoids decoding the same video twice.
    if (quality === 'proxy' && !asset.cache.proxyPath) {
      const existing = slots.source;
      if (existing) {
        slots.proxy = existing;
        return;
      }
    }
    if (quality === 'source' && slots.proxy && !asset.cache.proxyPath) {
      slots.source = slots.proxy;
      return;
    }

    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    if (quality === 'source') {
      video.src = sourceUrl(asset);
    } else {
      const fallback = sourceUrl(asset);
      video.src = proxyUrl(asset);
      let fellBack = video.src === fallback;
      video.addEventListener('error', () => {
        if (!fellBack) {
          fellBack = true;
          video.src = fallback;
          video.load();
        }
      });
    }
    video.addEventListener('loadeddata', this.notify);
    video.addEventListener('seeked', this.notify);
    video.addEventListener('canplay', this.notify);
    video.load();
    slots[quality] = video;
  }

  private createImage(asset: Asset): void {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', this.notify);
    image.addEventListener('error', this.notify);
    image.src = sourceUrl(asset);
    this.images.set(asset.id, image);
  }

  private removeVideo(id: string): void {
    const slots = this.videos.get(id);
    if (!slots) {
      return;
    }
    const seen = new Set<HTMLVideoElement>();
    for (const video of [slots.proxy, slots.source]) {
      if (!video || seen.has(video)) {
        continue;
      }
      seen.add(video);
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    this.videos.delete(id);
  }

  private removeImage(id: string): void {
    const image = this.images.get(id);
    if (!image) {
      return;
    }
    image.removeAttribute('src');
    this.images.delete(id);
  }

  private notify = (): void => {
    for (const listener of this.listeners) {
      listener();
    }
  };

  onReady(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Creates and returns the requested video slot if it does not exist yet. */
  ensure(
    assetId: string,
    quality: MediaQuality = this.defaultQuality,
  ): HTMLVideoElement | null {
    const asset = this.assets.get(assetId);
    if (!asset || asset.kind !== 'video') {
      return null;
    }
    const slots = this.videos.get(assetId) ?? {};
    this.videos.set(assetId, slots);
    if (slots[quality]) {
      return slots[quality] ?? null;
    }
    if (!asset.cache.proxyPath && (slots.proxy || slots.source)) {
      const shared = slots.source ?? slots.proxy ?? null;
      slots.proxy = shared ?? undefined;
      slots.source = shared ?? undefined;
      return shared;
    }
    this.createVideo(asset, quality);
    return slots[quality] ?? null;
  }

  video(
    assetId: string,
    quality: MediaQuality = this.defaultQuality,
  ): HTMLVideoElement | null {
    const slots = this.videos.get(assetId);
    if (!slots) {
      return null;
    }
    return (
      slots[quality] ?? slots[quality === 'proxy' ? 'source' : 'proxy'] ?? null
    );
  }

  image(assetId: string): HTMLImageElement | null {
    return this.images.get(assetId) ?? null;
  }

  media(
    assetId: string,
    quality: MediaQuality = this.defaultQuality,
  ): HTMLVideoElement | HTMLImageElement | null {
    return this.images.get(assetId) ?? this.video(assetId, quality);
  }

  isReady(
    assetId: string,
    quality: MediaQuality = this.defaultQuality,
  ): boolean {
    return mediaElementReady(this.media(assetId, quality));
  }

  asset(assetId: string): Asset | undefined {
    return this.assets.get(assetId);
  }

  dispose(): void {
    this.disposed = true;
    const videoIds = Array.from(this.videos.keys());
    const imageIds = Array.from(this.images.keys());
    for (const id of videoIds) {
      this.removeVideo(id);
    }
    for (const id of imageIds) {
      this.removeImage(id);
    }
    this.listeners.clear();
  }
}

export function seekVideo(
  video: HTMLVideoElement,
  seconds: number,
): Promise<void> {
  const clamped = Math.max(0, seconds);
  if (Math.abs(video.currentTime - clamped) < 0.0005) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      video.removeEventListener('seeked', finish);
      video.removeEventListener('error', finish);
      resolve();
    };
    video.addEventListener('seeked', finish, { once: true });
    video.addEventListener('error', finish, { once: true });
    try {
      video.currentTime = clamped;
    } catch {
      finish();
    }
    window.setTimeout(finish, 400);
  });
}

export function mediaReadyForAsset(
  assetId: string,
  pool: MediaPool,
  quality: MediaQuality = pool.defaultQuality,
): boolean {
  return pool.isReady(assetId, quality);
}
