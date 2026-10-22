import type { Asset } from '@kerf/model';

export type MediaSlot = 'source' | 'proxy' | 'thumbnail';

function encoded(value: string): string {
  return encodeURIComponent(value);
}

export function assetMediaUrl(asset: Asset, slot: MediaSlot): string {
  return `kerfmedia://asset/${encoded(asset.id)}/${slot}`;
}

function videoUrl(asset: Asset): string {
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

function mediaReady(element: HTMLVideoElement | HTMLImageElement): boolean {
  if (element instanceof HTMLVideoElement) {
    return element.readyState >= 2 && element.videoWidth > 0;
  }
  return element.complete && element.naturalWidth > 0;
}

/**
 * Owns the detached media elements used by the canvas. The pool is shared by
 * preview and export so both paths draw from the same source and seek logic.
 */
export class MediaPool {
  private readonly assets = new Map<string, Asset>();
  private readonly videos = new Map<string, HTMLVideoElement>();
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(assets: readonly Asset[] = []) {
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
        if (!this.videos.has(id)) {
          this.createVideo(asset);
        }
      } else if (!this.images.has(id)) {
        this.createImage(asset);
      }
    }
    for (const id of this.videos.keys()) {
      if (!next.has(id as Asset['id'])) {
        this.removeVideo(id);
      }
    }
    for (const id of this.images.keys()) {
      if (!next.has(id as Asset['id'])) {
        this.removeImage(id);
      }
    }
  }

  private createVideo(asset: Asset): void {
    const video = document.createElement('video');
    const fallback = sourceUrl(asset);
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = videoUrl(asset);
    let fellBack = video.src === fallback;
    video.addEventListener('error', () => {
      if (!fellBack) {
        fellBack = true;
        video.src = fallback;
        video.load();
      }
    });
    video.addEventListener('loadeddata', this.notify);
    video.addEventListener('seeked', this.notify);
    video.addEventListener('canplay', this.notify);
    video.load();
    this.videos.set(asset.id, video);
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
    const video = this.videos.get(id);
    if (!video) {
      return;
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
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

  video(assetId: string): HTMLVideoElement | null {
    return this.videos.get(assetId) ?? null;
  }

  image(assetId: string): HTMLImageElement | null {
    return this.images.get(assetId) ?? null;
  }

  media(assetId: string): HTMLVideoElement | HTMLImageElement | null {
    return this.videos.get(assetId) ?? this.images.get(assetId) ?? null;
  }

  isReady(assetId: string): boolean {
    const element = this.media(assetId);
    return element !== null && mediaReady(element);
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

export function mediaReadyForAsset(assetId: string, pool: MediaPool): boolean {
  return pool.isReady(assetId);
}
