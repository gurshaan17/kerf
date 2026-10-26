import { useEffect, useState } from 'react';
import { KerfMark, Button, Dialog } from '@kerf/ui';
import type { AppVersions } from '../shared/contracts';

export interface AboutDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const [versions, setVersions] = useState<AppVersions | null>(null);

  useEffect(() => {
    if (open) {
      setVersions(window.kerf.getVersions());
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="About Kerf"
      description="A local-first video editor for the footage on this machine."
      footer={
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <div className="space-y-5 text-[12px] leading-relaxed text-ink-muted">
        <div className="flex items-center gap-3">
          <KerfMark size={48} className="shrink-0" />
          <div>
            <p className="font-display text-[22px] leading-tight font-medium text-ink">
              Kerf
            </p>
            <p className="mt-0.5 font-mono text-[10px] tracking-[0.04em] text-ink-faint uppercase">
              Version 0.1.0
            </p>
          </div>
        </div>

        <p>
          Projects, media, analysis and exports stay in local folders. Kerf does
          not create an account, upload footage, or fall back to a cloud service
          on its own.
        </p>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-sm border border-line bg-surface-0 px-3 py-2.5 font-mono text-[10px]">
          <dt className="text-ink-faint uppercase">Electron</dt>
          <dd className="text-right text-ink-muted">
            {versions?.electron ?? '—'}
          </dd>
          <dt className="text-ink-faint uppercase">Chromium</dt>
          <dd className="text-right text-ink-muted">
            {versions?.chrome ?? '—'}
          </dd>
          <dt className="text-ink-faint uppercase">Node.js</dt>
          <dd className="text-right text-ink-muted">{versions?.node ?? '—'}</dd>
        </dl>

        <p className="text-[11px] text-ink-faint">
          Built with Electron, ffmpeg and whisper.cpp. Third-party notices are
          included with the source distribution.
        </p>
      </div>
    </Dialog>
  );
}
