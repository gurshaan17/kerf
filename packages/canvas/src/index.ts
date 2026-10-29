/** Public surface for the @kerf/canvas package. */
export {
  MediaPool,
  assetMediaUrl,
  mediaElementReady,
  mediaReadyForAsset,
  seekVideo,
} from './media-pool';
export type { MediaPoolOptions, MediaQuality, MediaSlot } from './media-pool';
export {
  drawOverlay,
  overlayTransitionOpacity,
  overlayTransitionProgress,
} from './overlays';
export type { DrawLayer, OverlayDrawOptions } from './overlays';
export { clipAtFrame, mediaSourceSeconds, renderFrame } from './render';
export type { RenderFrameOptions, RenderStats } from './render';
export {
  blurImageData,
  blurSurfaceRegion,
  scratchSurface,
  setScratchCanvasFactory,
} from './scratch';
export type {
  ScratchCanvas,
  ScratchCanvasFactory,
  ScratchSurface,
} from './scratch';
export { setFont, wrapText } from './text';
