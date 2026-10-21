import { contextBridge } from 'electron';
import type { KerfBridge } from '../shared/contracts';

// Keep the renderer sandboxed: expose only the specific, serializable values
// the UI needs instead of handing over Node.js or the whole `electron` module.
const bridge: KerfBridge = {
  getVersions: () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),
};

contextBridge.exposeInMainWorld('kerf', bridge);
