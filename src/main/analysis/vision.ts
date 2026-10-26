import { readFileSync } from 'node:fs';
import { generateText } from 'ai';
import type { Asset, Scene } from '@kerf/model';
import type { ProviderAccount } from '../../shared/contracts';
import type { ProjectRepository } from '../projects/repository';
import type { ProviderStore } from './providers';

const PROMPT = [
  'Describe this video frame for a searchable scene index.',
  'Write one or two plain sentences about the visible subjects, setting,',
  'action, framing, and mood. Do not identify people by name.',
].join(' ');

export interface DescribeScenesInput {
  readonly asset: Asset;
  readonly scenes: readonly Scene[];
  readonly providers: ProviderStore;
  readonly provider: ProviderAccount;
  readonly repository: ProjectRepository;
  readonly onlyUndescribed?: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number) => void;
}

export function descriptionCandidates(
  scenes: readonly Scene[],
  onlyUndescribed = false,
): Scene[] {
  return scenes.filter(
    (scene) =>
      Boolean(scene.thumbnailPath) &&
      (!onlyUndescribed || !scene.description?.trim()),
  );
}

export async function describeScenes(
  input: DescribeScenesInput,
): Promise<Scene[]> {
  const scenes = descriptionCandidates(
    input.scenes,
    input.onlyUndescribed ?? false,
  );
  if (scenes.length === 0) {
    throw new Error(
      input.onlyUndescribed
        ? 'Every detected scene already has a description.'
        : 'Detect scenes before describing keyframes.',
    );
  }
  const model = input.providers.model(input.provider);
  const updated: Scene[] = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (!scene?.thumbnailPath) {
      continue;
    }
    if (input.signal?.aborted) {
      throw new Error('The description run was cancelled.');
    }
    const data = readFileSync(scene.thumbnailPath);
    const result = await generateText({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            {
              type: 'image',
              image: data,
              mediaType: 'image/jpeg',
            },
          ],
        },
      ],
      maxOutputTokens: 180,
    });
    const description = result.text.trim();
    const saved = input.repository.saveScene({
      ...scene,
      description: description.length > 0 ? description : 'No description.',
    });
    updated.push(saved);
    input.onProgress?.((index + 1) / scenes.length);
  }
  input.onProgress?.(1);
  return updated;
}
