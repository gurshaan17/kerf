/** Serializable values the renderer may request from the main process. */
export interface AppVersions {
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
}

/** The complete surface exposed on `window.kerf`. Keep this allowlist small. */
export interface KerfBridge {
  readonly getVersions: () => AppVersions;
}
