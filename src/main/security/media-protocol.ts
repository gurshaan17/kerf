import { protocol } from 'electron';
import type { ProjectRepository } from '../projects';
import { serveMediaRequest } from './media-paths';

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'kerfmedia',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

export function installMediaProtocol(repository: ProjectRepository): void {
  protocol.handle('kerfmedia', (request) =>
    serveMediaRequest(repository, request.url, request),
  );
}

export * from './media-paths';
