import { protocol } from 'electron';
import type { ProjectRepository } from '../projects';
import { serveMediaRequest } from './media-paths';
import type { NoiseReductionService } from '../audio/noise-reduction';

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

export function installMediaProtocol(
  repository: ProjectRepository,
  noiseReduction: NoiseReductionService,
): void {
  protocol.handle('kerfmedia', (request) =>
    serveMediaRequest(repository, request.url, request, noiseReduction),
  );
}

export * from './media-paths';
