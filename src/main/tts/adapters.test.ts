import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TtsProvider } from '../../shared/tts';
import { synthesizeSpeech } from './adapters';

function provider(overrides: Partial<TtsProvider> = {}): TtsProvider {
  return {
    id: 'tts-fixture',
    label: 'Speech',
    kind: 'openai-compatible',
    endpoint: 'https://speech.example/v1/audio/speech',
    model: 'tts-1',
    voice: 'alloy',
    region: 'us-east-1',
    language: 'en-US',
    speed: 1,
    hasCredentials: true,
    ...overrides,
  };
}

function mockFetch(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const signal = () => new AbortController().signal;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('speech provider adapters', () => {
  it('signs AWS requests with region, scope and temporary credentials', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T12:34:56Z'));
    const fetch = mockFetch(new Response('mp3'));
    await synthesizeSpeech(
      provider({ kind: 'aws-polly', model: 'neural', voice: 'Joanna' }),
      JSON.stringify({
        accessKeyId: 'AKID',
        secretAccessKey: 'secret',
        sessionToken: 'temporary-token',
      }),
      'Hello',
      signal(),
    );
    const [url, request] = fetch.mock.calls[0]!;
    expect(url).toBe('https://polly.us-east-1.amazonaws.com/v1/speech');
    expect(request?.headers).toMatchObject({
      'x-amz-date': '20261031T123456Z',
      'x-amz-security-token': 'temporary-token',
      authorization: expect.stringMatching(
        /^AWS4-HMAC-SHA256 Credential=AKID\/20261031\/us-east-1\/polly\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, Signature=[a-f0-9]{64}$/,
      ),
    });
    expect(request?.redirect).toBe('error');
    expect(JSON.parse(String(request?.body))).toMatchObject({
      Engine: 'neural',
      Text: 'Hello',
      TextType: 'text',
      OutputFormat: 'mp3',
      VoiceId: 'Joanna',
    });
  });

  it('escapes narration as text when using AWS SSML for speed', async () => {
    const fetch = mockFetch(new Response('mp3'));
    await synthesizeSpeech(
      provider({ kind: 'aws-polly', model: 'neural', speed: 1.2 }),
      JSON.stringify({ accessKeyId: 'AKID', secretAccessKey: 'secret' }),
      '<break/> & "hello"',
      signal(),
    );
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).Text).toBe(
      '<speak><prosody rate="120%">&lt;break/&gt; &amp; &quot;hello&quot;</prosody></speak>',
    );
  });

  it('sends Google API keys in headers and decodes base64 audio', async () => {
    const fetch = mockFetch(
      Response.json({ audioContent: Buffer.from('audio').toString('base64') }),
    );
    const audio = await synthesizeSpeech(
      provider({ kind: 'google-cloud', voice: 'en-US-Neural2-F' }),
      'private-key',
      'Hello',
      signal(),
    );
    const [url, request] = fetch.mock.calls[0]!;
    expect(url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize');
    expect(request?.headers).toMatchObject({ 'x-goog-api-key': 'private-key' });
    expect(JSON.parse(String(request?.body))).toEqual({
      input: { text: 'Hello' },
      voice: { languageCode: 'en-US', name: 'en-US-Neural2-F' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1 },
    });
    expect(audio.bytes.toString()).toBe('audio');
  });

  it.each([
    ['{secret-bad-json', 'valid credentials JSON'],
    [
      JSON.stringify({
        client_email: 'service@example.com',
        private_key: 'secret-invalid-key',
      }),
      'private key is invalid',
    ],
  ])(
    'rejects malformed Google service account credentials without exposing them',
    async (credentials, message) => {
      const fetch = mockFetch(new Response('unused'));
      await expect(
        synthesizeSpeech(
          provider({ kind: 'google-cloud' }),
          credentials,
          'Hello',
          signal(),
        ),
      ).rejects.toThrow(message);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('sends Smallest its documented voice/model contract and requests WAV', async () => {
    const fetch = mockFetch(new Response('wav'));
    const result = await synthesizeSpeech(
      provider({ kind: 'smallest', model: '', voice: 'magnus' }),
      'key',
      'Hello',
      signal(),
    );
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://api.smallest.ai/waves/v1/tts',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({
      model: 'lightning_v3.1',
      voice_id: 'magnus',
      language: 'en',
      output_format: 'wav',
    });
    expect(result.extension).toBe('wav');
  });

  it.each([
    ['en-US', 'en-us'],
    ['en-GB', 'en-gb'],
    ['hi', 'hi'],
    ['pt-BR', 'pt-br'],
  ])('normalizes LemonFox language %s to %s', async (language, expected) => {
    const fetch = mockFetch(new Response('mp3'));
    await synthesizeSpeech(
      provider({ kind: 'lemonfox', language }),
      'key',
      'Hello',
      signal(),
    );
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://api.lemonfox.ai/v1/audio/speech',
    );
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(body.language).toBe(expected);
    expect(body).not.toHaveProperty('model');
  });

  it.each([
    'http://speech.example/v1/audio/speech',
    'https://user:secret@speech.example/v1/audio/speech',
    'https://speech.example/v1/audio/speech?key=secret',
  ])(
    'rejects unsafe custom endpoint %s before sending credentials',
    async (endpoint) => {
      const fetch = mockFetch(new Response('unused'));
      await expect(
        synthesizeSpeech(provider({ endpoint }), 'key', 'Hello', signal()),
      ).rejects.toThrow('require HTTPS');
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('permits an explicit localhost HTTP endpoint', async () => {
    const fetch = mockFetch(new Response('audio'));
    await synthesizeSpeech(
      provider({ endpoint: 'http://127.0.0.1:8080/v1/audio/speech' }),
      'key',
      'Hello',
      signal(),
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('redacts provider error bodies and network errors', async () => {
    const fetch = mockFetch(
      new Response('secret-provider-token', { status: 403 }),
    );
    await expect(
      synthesizeSpeech(provider(), 'key', 'Hello', signal()),
    ).rejects.toThrow(
      /^Speech provider returned HTTP 403\. Check the credentials and speech permissions\.$/,
    );
    fetch.mockRejectedValueOnce(new Error('secret-provider-token in request'));
    await expect(
      synthesizeSpeech(provider(), 'key', 'Hello', signal()),
    ).rejects.toThrow(/^Could not reach the speech provider\./);
  });

  it('cancels an oversized response without importing it', async () => {
    const cancel = vi.fn();
    mockFetch(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(30 * 1024 * 1024 + 1));
          },
          cancel,
        }),
      ),
    );
    await expect(
      synthesizeSpeech(provider(), 'key', 'Hello', signal()),
    ).rejects.toThrow('30 MB limit');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('limits synchronous requests by UTF-8 bytes before spending provider credits', async () => {
    const fetch = mockFetch(new Response('unused'));
    await expect(
      synthesizeSpeech(provider(), 'key', '好'.repeat(1000), signal()),
    ).rejects.toThrow('2,800 UTF-8 bytes');
    expect(fetch).not.toHaveBeenCalled();
  });
});
