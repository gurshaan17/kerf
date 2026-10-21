import { contextBridge } from 'electron';

// Keep the renderer sandboxed: expose only the specific, serializable values
// the UI needs instead of handing over Node.js or the whole `electron` module.
contextBridge.exposeInMainWorld('kerf', {
  getVersions: () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),
});
