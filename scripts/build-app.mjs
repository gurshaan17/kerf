import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const worker = resolve(
  root,
  'node_modules/@electron-forge/plugin-vite/dist/subprocess-worker.js',
);

// This mirrors the build and renderer entries in forge.config.mts. Forge's
// Vite worker is reused so the E2E bundle gets the same production defines as
// a packaged app without producing an installer.
const pluginConfig = {
  build: [
    {
      entry: 'src/main/main.ts',
      config: 'vite.main.config.mts',
      target: 'main',
    },
    {
      entry: 'src/preload/preload.ts',
      config: 'vite.preload.config.mts',
      target: 'preload',
    },
  ],
  renderer: [
    {
      name: 'main_window',
      config: 'vite.renderer.config.mts',
    },
  ],
};

const jobs = [
  { kind: 'build', index: 0, label: 'main' },
  { kind: 'build', index: 1, label: 'preload' },
  { kind: 'renderer', index: 0, label: 'renderer' },
];

function run(job) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [worker], {
      cwd: root,
      env: {
        ...process.env,
        FORGE_VITE_PROJECT_DIR: root,
        FORGE_VITE_KIND: job.kind,
        FORGE_VITE_INDEX: String(job.index),
        FORGE_VITE_CONFIG: JSON.stringify(pluginConfig),
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`Vite ${job.label} build exited with code ${code}.`));
    });
  });
}

rmSync(resolve(root, '.vite'), { recursive: true, force: true });
for (const job of jobs) {
  await run(job);
}
console.log('Built Kerf for Electron E2E.');
