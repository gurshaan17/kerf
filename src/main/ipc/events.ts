import { BrowserWindow } from 'electron';
import {
  KERF_IPC,
  type KerfEvent,
  type KerfEventEnvelope,
} from '../../shared/contracts';

export function createEventEnvelope(event: KerfEvent): KerfEventEnvelope {
  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    event,
  };
}

export function broadcastEvent(event: KerfEvent): void {
  const envelope = createEventEnvelope(event);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(KERF_IPC.event, envelope);
    }
  }
}
