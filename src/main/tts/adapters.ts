import { createHash, createHmac, createSign } from 'node:crypto';
import type { TtsProvider } from '../../shared/tts';

const MAX_RESPONSE_BYTES = 30 * 1024 * 1024;
type SpeechAudio = { bytes: Buffer; extension: 'mp3' | 'wav' };

/** Never include vendor response bodies or fetch errors: they can echo credentials. */
async function post(
  url: string,
  body: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal,
      redirect: 'error',
    });
  } catch {
    if (signal.aborted)
      throw new Error('Speech generation was cancelled or timed out.');
    throw new Error(
      'Could not reach the speech provider. Check its endpoint and your connection.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const hint =
      response.status === 401 || response.status === 403
        ? 'Check the credentials and speech permissions.'
        : response.status === 429
          ? 'The provider rate limit or quota was reached.'
          : 'Check the model, voice, language, and provider availability.';
    throw new Error(
      `Speech provider returned HTTP ${response.status}. ${hint}`,
    );
  }
  if (!response.body) throw new Error('The speech provider returned no audio.');
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(
          'The speech response exceeds the 30 MB limit. Generate a shorter row.',
        );
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('The speech response')
    )
      throw error;
    throw new Error(
      'The speech response was interrupted. Try generating the row again.',
    );
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error('The speech provider returned an empty response.');
  return Buffer.concat(chunks);
}

function credentialJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    /* Use a fixed error to avoid leaking secrets. */
  }
  throw new Error('This provider requires a valid credentials JSON object.');
}

function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Credentials are missing ${name}.`);
  return value.trim();
}

function customEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a complete speech endpoint URL.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw new Error(
      'Speech endpoints require HTTPS, or HTTP on localhost, without URL credentials, query, or fragment.',
    );
  }
  return url.toString();
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}
function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char]!,
  );
}

async function polly(
  config: TtsProvider,
  credentials: string,
  text: string,
  signal: AbortSignal,
): Promise<SpeechAudio> {
  const auth = credentialJson(credentials);
  const accessKeyId = required(auth.accessKeyId, 'accessKeyId');
  const secretAccessKey = required(auth.secretAccessKey, 'secretAccessKey');
  const sessionToken =
    auth.sessionToken === undefined
      ? undefined
      : required(auth.sessionToken, 'sessionToken');
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(config.region))
    throw new Error('Enter a valid AWS region.');
  const engine = config.model || 'neural';
  if (!['standard', 'neural', 'long-form', 'generative'].includes(engine))
    throw new Error(
      'AWS model must be standard, neural, long-form, or generative.',
    );
  if (config.speed !== 1 && engine === 'generative')
    throw new Error('Set speech speed to 1 for the AWS generative engine.');
  const body = JSON.stringify({
    Engine: engine,
    VoiceId: config.voice,
    OutputFormat: 'mp3',
    ...(config.language ? { LanguageCode: config.language } : {}),
    TextType: config.speed === 1 ? 'text' : 'ssml',
    Text:
      config.speed === 1
        ? text
        : `<speak><prosody rate="${Math.round(config.speed * 100)}%">${escapeXml(text)}</prosody></speak>`,
  });
  const suffix = config.region.startsWith('cn-')
    ? 'amazonaws.com.cn'
    : 'amazonaws.com';
  const host = `polly.${config.region}.${suffix}`;
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host,
    'x-amz-date': date,
  };
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names
    .map((name) => `${name}:${headers[name]!.trim()}\n`)
    .join('');
  const scope = `${date.slice(0, 8)}/${config.region}/polly/aws4_request`;
  const canonical = [
    'POST',
    '/v1/speech',
    '',
    canonicalHeaders,
    signedHeaders,
    digest(body),
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    date,
    scope,
    digest(canonical),
  ].join('\n');
  const key = hmac(
    hmac(
      hmac(hmac(`AWS4${secretAccessKey}`, date.slice(0, 8)), config.region),
      'polly',
    ),
    'aws4_request',
  );
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(key, stringToSign).toString('hex')}`;
  return {
    bytes: await post(`https://${host}/v1/speech`, body, headers, signal),
    extension: 'mp3',
  };
}

async function google(
  config: TtsProvider,
  credentials: string,
  text: string,
  signal: AbortSignal,
): Promise<SpeechAudio> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (credentials.trim().startsWith('{')) {
    const auth = credentialJson(credentials);
    const email = required(auth.client_email, 'client_email');
    const privateKey = required(auth.private_key, 'private_key');
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    let signature: string;
    try {
      signature = createSign('RSA-SHA256')
        .update(unsigned)
        .sign(privateKey)
        .toString('base64url');
    } catch {
      throw new Error('The Google service account private key is invalid.');
    }
    const tokenBytes = await post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }).toString(),
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal,
    );
    const token = parseJson(tokenBytes);
    headers.Authorization = `Bearer ${required(token.access_token, 'access_token in Google authorization response')}`;
  } else {
    headers['x-goog-api-key'] = required(credentials, 'API key');
  }
  const body = JSON.stringify({
    input: { text },
    voice: { languageCode: config.language, name: config.voice },
    audioConfig: { audioEncoding: 'MP3', speakingRate: config.speed },
  });
  const result = parseJson(
    await post(
      'https://texttospeech.googleapis.com/v1/text:synthesize',
      body,
      headers,
      signal,
    ),
  );
  if (typeof result.audioContent !== 'string' || !result.audioContent)
    throw new Error('Google returned no audio content.');
  const bytes = Buffer.from(result.audioContent, 'base64');
  if (!bytes.length || bytes.length > MAX_RESPONSE_BYTES)
    throw new Error('Google returned invalid or oversized audio.');
  return { bytes, extension: 'mp3' };
}

function parseJson(bytes: Buffer): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    /* Provider bodies may contain secrets; never echo them. */
  }
  throw new Error('The speech provider returned an invalid JSON response.');
}

/** Dedicated vendor adapters normalize responses to project-importable audio. */
export async function synthesizeSpeech(
  config: TtsProvider,
  credentials: string,
  text: string,
  signal: AbortSignal,
): Promise<SpeechAudio> {
  if (!text.trim())
    throw new Error('Enter narration text before generating speech.');
  // Conservative shared limit fits Polly and Google's synchronous UTF-8 limits.
  if (Buffer.byteLength(text, 'utf8') > 2800)
    throw new Error(
      'This row is too long for speech generation. Split it into shorter rows (under 2,800 UTF-8 bytes).',
    );
  if (config.kind === 'aws-polly')
    return polly(config, credentials, text, signal);
  if (config.kind === 'google-cloud')
    return google(config, credentials, text, signal);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${required(credentials, 'API key')}`,
  };
  if (config.kind === 'smallest') {
    const body = JSON.stringify({
      text,
      voice_id: config.voice,
      model: config.model || 'lightning_v3.1',
      sample_rate: 24000,
      speed: config.speed,
      output_format: 'wav',
      ...(config.language
        ? { language: config.language.split('-')[0]!.toLowerCase() }
        : {}),
    });
    return {
      bytes: await post(
        'https://api.smallest.ai/waves/v1/tts',
        body,
        { ...headers, Accept: 'audio/wav' },
        signal,
      ),
      extension: 'wav',
    };
  }
  const endpoint =
    config.kind === 'lemonfox'
      ? 'https://api.lemonfox.ai/v1/audio/speech'
      : customEndpoint(config.endpoint);
  const body = JSON.stringify({
    input: text,
    voice: config.voice,
    response_format: 'mp3',
    speed: config.speed,
    ...(config.kind === 'lemonfox'
      ? { language: config.language.toLowerCase() }
      : { model: config.model }),
  });
  return {
    bytes: await post(endpoint, body, headers, signal),
    extension: 'mp3',
  };
}
