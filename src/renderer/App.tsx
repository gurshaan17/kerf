import { useEffect, useState } from 'react';

type Versions = Record<'electron' | 'chrome' | 'node', string>;

export default function App() {
  const [versions, setVersions] = useState<Versions | null>(null);

  useEffect(() => {
    setVersions(window.kerf.getVersions());
  }, []);

  return (
    <main className="app">
      <h1>Kerf</h1>
      <p>A minimal Electron + Vite + React + TypeScript starter.</p>

      <dl className="versions">
        <dt>Electron</dt>
        <dd>{versions?.electron ?? '—'}</dd>
        <dt>Chromium</dt>
        <dd>{versions?.chrome ?? '—'}</dd>
        <dt>Node</dt>
        <dd>{versions?.node ?? '—'}</dd>
      </dl>
    </main>
  );
}
