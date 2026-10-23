import { describe, expect, it } from 'vitest';
import {
  AgentCredentialError,
  buildAgentSystemPrompt,
  createLanguageModel,
  KERF_AGENT_SYSTEM_PROMPT,
  LATEST_GOOGLE_MODEL,
  normalizeGoogleModel,
  providerBaseUrl,
  providerModelName,
} from './index';

describe('agent prompt', () => {
  it('states the verification contract and the catalog names', () => {
    expect(KERF_AGENT_SYSTEM_PROMPT).toContain('Read before you write.');
    expect(KERF_AGENT_SYSTEM_PROMPT).toContain(
      'After any edit, call readTimeline',
    );
    expect(KERF_AGENT_SYSTEM_PROMPT).toContain('readExport');
    expect(KERF_AGENT_SYSTEM_PROMPT).toContain('writeCaptions');
    expect(KERF_AGENT_SYSTEM_PROMPT).toContain('reference material');
  });

  it('adds session facts without changing the contract', () => {
    const prompt = buildAgentSystemPrompt({
      projectName: 'Interview',
      sequenceName: 'Main cut',
      durationFrames: 480,
      providerLabel: 'Ollama',
      referenceName: 'Editorial reference',
    });
    expect(prompt).toContain('Open project: Interview.');
    expect(prompt).toContain('Sequence duration: 480 frames.');
    expect(prompt).toContain('Configured chat provider: Ollama.');
    expect(prompt).toContain('Active reference profile: Editorial reference.');
  });
});

describe('agent provider adapters', () => {
  it('rejects a cloud provider without a key with a clean error', () => {
    expect(() =>
      createLanguageModel({
        kind: 'openai',
        label: 'OpenAI',
        baseUrl: null,
        model: null,
        apiKey: null,
      }),
    ).toThrow(AgentCredentialError);
    expect(() =>
      createLanguageModel({
        kind: 'openai',
        label: 'OpenAI',
        baseUrl: null,
        model: null,
        apiKey: null,
      }),
    ).toThrow(/Add an API key for OpenAI/);
  });

  it('builds local adapters without a key and uses local defaults', () => {
    const model = createLanguageModel({
      kind: 'ollama',
      label: 'Ollama',
      baseUrl: null,
      model: null,
      apiKey: null,
    });
    expect(model).toBeTruthy();
    expect(
      providerBaseUrl({
        kind: 'ollama',
        label: 'Ollama',
        baseUrl: null,
        model: null,
        apiKey: null,
      }),
    ).toBe('http://127.0.0.1:11434/v1');
    expect(
      providerModelName({
        kind: 'ollama',
        label: 'Ollama',
        baseUrl: null,
        model: null,
        apiKey: null,
      }),
    ).toBe('llama3.2');
  });

  it('uses the latest Gemini model and upgrades legacy defaults', () => {
    const google = (model: string | null) => ({
      kind: 'google' as const,
      label: 'Google Gemini',
      baseUrl: null,
      model,
      apiKey: 'key',
    });

    expect(LATEST_GOOGLE_MODEL).toBe('gemini-3.8-flash');
    expect(providerModelName(google(null))).toBe(LATEST_GOOGLE_MODEL);
    expect(providerModelName(google('gemini-2.0-flash'))).toBe(
      LATEST_GOOGLE_MODEL,
    );
    expect(providerModelName(google('models/gemini-2.0-flash'))).toBe(
      LATEST_GOOGLE_MODEL,
    );
    expect(providerModelName(google('gemini-3.1-pro-preview'))).toBe(
      'gemini-3.1-pro-preview',
    );
    expect(normalizeGoogleModel('models/gemini-3.8-flash')).toBe(
      LATEST_GOOGLE_MODEL,
    );
  });
});
