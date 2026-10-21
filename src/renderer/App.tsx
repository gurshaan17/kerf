import { useEffect, useState } from 'react';
import type { AppVersions } from '../shared/contracts';

export default function App() {
  const [versions, setVersions] = useState<AppVersions | null>(null);

  useEffect(() => {
    setVersions(window.kerf.getVersions());
  }, []);

  return (
    <main className="start">
      <section className="start__panel">
        <p className="start__eyebrow">Local-first cutting room</p>
        <h1 className="start__title">Kerf</h1>
        <p className="start__lede">
          A quiet place to cut, compose and finish. Every frame is measured, and
          your media never leaves this machine.
        </p>

        <dl className="start__versions">
          <dt>Electron</dt>
          <dd>{versions?.electron ?? '—'}</dd>
          <dt>Chromium</dt>
          <dd>{versions?.chrome ?? '—'}</dd>
          <dt>Node</dt>
          <dd>{versions?.node ?? '—'}</dd>
        </dl>

        <p className="start__note">
          Workspace shell arrives in the next build.
        </p>
      </section>
    </main>
  );
}
