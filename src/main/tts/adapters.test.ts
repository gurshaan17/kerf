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
  it.each([
    'gpt-4o-mini-tts',
    'gpt-4o-mini-tts-2025-12-15',
    'tts-1',
    'tts-1-hd',
    '',
  ])(
    'uses native OpenAI authentication and fixed endpoint for model %s',
    async (model) => {
      const fetch = mockFetch(new Response('mp3'));
      const result = await synthesizeSpeech(
        provider({
          kind: 'openai',
          model,
          endpoint: 'https://evil.example/steal',
        }),
        'openai-key',
        'Hello',
        signal(),
      );
      const [url, request] = fetch.mock.calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/audio/speech');
      expect(request?.headers).toMatchObject({
        Authorization: 'Bearer openai-key',
      });
      expect(JSON.parse(String(request?.body))).toEqual({
        input: 'Hello',
        voice: 'alloy',
        response_format: 'mp3',
        speed: 1,
        model: model || 'gpt-4o-mini-tts',
      });
      expect(result.extension).toBe('mp3');
    },
  );

  function geminiResponse(
    data: Buffer,
    mimeType = 'audio/L16;codec=pcm;rate=24000',
  ): Response {
    return Response.json({
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              { inlineData: { data: data.toString('base64'), mimeType } },
            ],
          },
        },
      ],
    });
  }

  it.each(['gemini-3.1-flash-tts-preview', 'gemini-2.5-pro-preview-tts'])(
    'wraps Gemini preview PCM as mono 16-bit WAV for %s',
    async (model) => {
      const pcm = Buffer.from([1, 0, 255, 127]);
      const fetch = mockFetch(geminiResponse(pcm));
      const result = await synthesizeSpeech(
        provider({
          kind: 'gemini',
          model,
          voice: 'Kore',
          endpoint: 'https://evil.example/steal',
        }),
        'gemini-key',
        'Hello',
        signal(),
      );
      const [url, request] = fetch.mock.calls[0]!;
      expect(url).toBe(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      );
      expect(request?.headers).toMatchObject({
        'x-goog-api-key': 'gemini-key',
      });
      expect(request?.headers).not.toHaveProperty('Authorization');
      expect(JSON.parse(String(request?.body))).toEqual({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
      });
      expect(result.extension).toBe('wav');
      expect(result.bytes.toString('ascii', 0, 4)).toBe('RIFF');
      expect(result.bytes.readUInt16LE(22)).toBe(1);
      expect(result.bytes.readUInt32LE(24)).toBe(24000);
      expect(result.bytes.readUInt16LE(34)).toBe(16);
      expect(result.bytes.subarray(44)).toEqual(pcm);
    },
  );

  it.each(['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', ''])(
    'preserves Gemini 3.8 WAV and uses its native voice contract for %s',
    async (model) => {
      const wav = Buffer.alloc(46);
      wav.write('RIFF', 0);
      wav.write('WAVE', 8);
      const fetch = mockFetch(geminiResponse(wav, 'audio/wav'));
      const result = await synthesizeSpeech(
        provider({ kind: 'gemini', model, voice: 'Kore' }),
        'gemini-key',
        'Hello',
        signal(),
      );
      expect(fetch.mock.calls[0]![0]).toBe(
        `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-3.8-flash-tts'}:generateContent`,
      );
      expect(
        JSON.parse(String(fetch.mock.calls[0]![1]?.body)).generationConfig
          .speechConfig.voiceConfig,
      ).toEqual({ voice: 'Kore' });
      expect(result.bytes).toEqual(wav);
    },
  );

  it.each([
    {},
    {
      promptFeedback: {
        blockReason: 'SAFETY',
        blockReasonMessage: 'secret-provider-message',
      },
    },
    { candidates: [{ finishReason: 'SAFETY' }] },
    {
      candidates: [
        { content: { parts: [{ text: 'secret-provider-message' }] } },
      ],
    },
    { candidates: [{ content: { parts: [] } }] },
    {
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/mp3' } }],
          },
        },
      ],
    },
    {
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: '????', mimeType: 'audio/wav' } }],
          },
        },
      ],
    },
  ])(
    'rejects missing, blocked, nonaudio or malformed Gemini output without exposing its contents',
    async (response) => {
      mockFetch(Response.json(response));
      await expect(
        synthesizeSpeech(
          provider({ kind: 'gemini', model: 'gemini-3.8-flash-tts' }),
          'gemini-key',
          'Hello',
          signal(),
        ),
      ).rejects.toThrow(
        /^Gemini returned no complete, unambiguous speech audio\./,
      );
    },
  );

  it.each([
    'audio/L16',
    'audio/L16;rate=0',
    'audio/L16;rate=100000',
    'audio/L16;rate=24000;channels=2',
  ])('rejects PCM with unsupported parameters: %s', async (mime) => {
    mockFetch(geminiResponse(Buffer.from([0, 0]), mime));
    await expect(
      synthesizeSpeech(
        provider({ kind: 'gemini', model: 'gemini-3.1-flash-tts-preview' }),
        'key',
        'Hello',
        signal(),
      ),
    ).rejects.toThrow('no complete');
  });

  it('rejects truncated PCM rather than writing an invalid WAV', async () => {
    mockFetch(geminiResponse(Buffer.from([0, 0, 0])));
    await expect(
      synthesizeSpeech(
        provider({ kind: 'gemini', model: 'gemini-3.1-flash-tts-preview' }),
        'key',
        'Hello',
        signal(),
      ),
    ).rejects.toThrow('invalid or oversized PCM');
  });

  it('rejects multiple Gemini audio alternatives', async () => {
    const candidate = {
      content: {
        parts: [
          { inlineData: { data: 'AAAA', mimeType: 'audio/L16;rate=24000' } },
        ],
      },
    };
    mockFetch(Response.json({ candidates: [candidate, candidate] }));
    await expect(
      synthesizeSpeech(
        provider({ kind: 'gemini', model: 'gemini-3.1-flash-tts-preview' }),
        'key',
        'Hello',
        signal(),
      ),
    ).rejects.toThrow('no complete');
  });

  it('rejects Gemini speed changes before sending a paid request', async () => {
    const fetch = mockFetch(new Response('unused'));
    await expect(
      synthesizeSpeech(
        provider({ kind: 'gemini', model: 'gemini-3.8-flash-tts', speed: 1.2 }),
        'key',
        'Hello',
        signal(),
      ),
    ).rejects.toThrow('requires speech speed 1');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['openai', 'gemini'] as const)(
    'rejects unsupported native %s models before sending credentials',
    async (kind) => {
      const fetch = mockFetch(new Response('unused'));
      await expect(
        synthesizeSpeech(
          provider({ kind, model: '../steal-key' }),
          'key',
          'Hello',
          signal(),
        ),
      ).rejects.toThrow('supported');
      expect(fetch).not.toHaveBeenCalled();
    },
  );

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
