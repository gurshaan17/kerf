import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createXai } from '@ai-sdk/xai';
import type { LanguageModel } from 'ai';

export type AgentProviderKind =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'ollama'
  | 'openai-compatible';

export interface AgentProviderConfig {
  readonly kind: AgentProviderKind;
  readonly label: string;
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly apiKey: string | null;
}

const DEFAULT_BASE_URL: Partial<Record<AgentProviderKind, string>> = {
  ollama: 'http://127.0.0.1:11434/v1',
  'openai-compatible': 'http://127.0.0.1:11434/v1',
};

const DEFAULT_CHAT_MODEL: Record<AgentProviderKind, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  google: 'gemini-2.0-flash',
  xai: 'grok-2-latest',
  ollama: 'llama3.2',
  'openai-compatible': 'llama3.2',
};

export class AgentCredentialError extends Error {
  readonly code = 'missing-key';

  constructor(message: string) {
    super(message);
    this.name = 'AgentCredentialError';
  }
}

export function providerNeedsKey(kind: AgentProviderKind): boolean {
  return kind !== 'ollama' && kind !== 'openai-compatible';
}

export function providerBaseUrl(config: AgentProviderConfig): string | null {
  return config.baseUrl?.trim() || DEFAULT_BASE_URL[config.kind] || null;
}

export function providerModelName(config: AgentProviderConfig): string {
  return config.model?.trim() || DEFAULT_CHAT_MODEL[config.kind];
}

export function createLanguageModel(
  config: AgentProviderConfig,
): LanguageModel {
  const apiKey = config.apiKey?.trim() || null;
  if (providerNeedsKey(config.kind) && !apiKey) {
    throw new AgentCredentialError(
      `Add an API key for ${config.label} before using chat.`,
    );
  }
  const baseURL = providerBaseUrl(config) ?? undefined;
  const model = providerModelName(config);
  switch (config.kind) {
    case 'openai':
      return createOpenAI({ apiKey: apiKey ?? undefined, baseURL })(model);
    case 'anthropic':
      return createAnthropic({ apiKey: apiKey ?? undefined, baseURL })(model);
    case 'google':
      return createGoogle({ apiKey: apiKey ?? undefined, baseURL })(model);
    case 'xai':
      return createXai({ apiKey: apiKey ?? undefined, baseURL })(model);
    case 'ollama':
    case 'openai-compatible':
      return createOpenAICompatible({
        name: config.kind,
        baseURL: baseURL ?? 'http://127.0.0.1:11434/v1',
        apiKey: apiKey ?? 'local',
      }).chatModel(model);
  }
}

export function credentialHint(error: unknown): string | null {
  if (error instanceof AgentCredentialError) {
    return error.message;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/api key|unauthorized|401|authentication/i.test(message)) {
    return 'Check the provider API key in AI settings, then try again.';
  }
  if (/ECONNREFUSED|fetch failed|connect/i.test(message)) {
    return 'The provider is not reachable. For Ollama, make sure the local server is running.';
  }
  return null;
}
