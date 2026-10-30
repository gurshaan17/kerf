// Disposable Phase 0 quality runner. Does not open or write Kerf projects.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const categories = ['screen', 'camera', 'static', 'long', 'fast-ui'];
const manifestSchema = z.object({
  clips: z
    .array(z.object({ kind: z.enum(categories), path: z.string().min(1) }))
    .min(1)
    .max(5),
  provider: z
    .object({
      kind: z.enum([
        'openai',
        'anthropic',
        'google',
        'xai',
        'ollama',
        'openai-compatible',
      ]),
      model: z.string().min(1),
      baseUrl: z.string().url().optional(),
    })
    .optional(),
  resolutions: z
    .array(z.number().int().min(768).max(2160))
    .default([768, 1280]),
  widths: z.array(z.number().int().min(1).max(3)).default([1, 3]),
  overlaps: z.array(z.boolean()).default([false, true]),
  changeThreshold: z.number().min(0).max(1).default(0.025),
  textContext: z.boolean().default(true),
  maxOutputTokens: z.number().int().min(1024).max(16384).default(8192),
  lastHoldSeconds: z.number().positive().max(30).default(3),
  // Rates are optional, explicitly supplied USD per million tokens.
  prices: z
    .object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
    })
    .optional(),
});
const responseSchema = z.object({
  segments: z
    .array(
      z.object({
        startFrameIndex: z.number().int().nonnegative(),
        endFrameIndex: z.number().int().nonnegative(),
        text: z.string().trim().min(1).max(600),
      }),
    )
    .max(100),
});

export function chunksFor(samples, duration) {
  const chunks = [];
  for (const sample of samples) {
    let chunk = chunks.at(-1);
    if (
      !chunk ||
      chunk.samples.length === 8 ||
      sample.time - chunk.start >= 12
    ) {
      chunk = { index: chunks.length, start: sample.time, samples: [] };
      chunks.push(chunk);
    }
    chunk.samples.push(sample);
  }
  return chunks.map((chunk, i) => ({
    ...chunk,
    end: chunks[i + 1]?.start ?? duration,
  }));
}

export function chunkFrames(chunks, index, overlap) {
  const context =
    overlap && index > 0
      ? [{ ...chunks[index - 1].samples.at(-1), contextOnly: true }]
      : [];
  return [
    ...context,
    ...chunks[index].samples.map((s) => ({ ...s, contextOnly: false })),
  ];
}

export function validateSegments(value, frames, chunk) {
  return responseSchema.parse(value).segments.map((s) => {
    const start = frames[s.startFrameIndex];
    const end = frames[s.endFrameIndex];
    if (
      !start ||
      !end ||
      start.contextOnly ||
      end.contextOnly ||
      s.endFrameIndex < s.startFrameIndex
    ) {
      throw new Error(
        `Chunk ${chunk.index}: invalid or context-only frame reference`,
      );
    }
    return {
      text: s.text,
      start: start.time,
      end: frames[s.endFrameIndex + 1]?.time ?? chunk.end,
      evidence: frames
        .slice(s.startFrameIndex, s.endFrameIndex + 1)
        .map((f) => f.time),
      evidenceReferences: frames
        .slice(s.startFrameIndex, s.endFrameIndex + 1)
        .map((f, offset) => ({
          chunk: chunk.index,
          index: s.startFrameIndex + offset,
          time: f.time,
        })),
      chunk: chunk.index,
    };
  });
}

export function parseResponse(text) {
  const fenced = text.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  const value = JSON.parse(fenced ? fenced[1] : text);
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected one JSON object');
  return value;
}

export function deriveNarrationIntervals(rows, duration, holdSeconds = 3) {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(holdSeconds) ||
    holdSeconds <= 0
  )
    throw new Error('Invalid duration or final hold');
  const starts = rows.map((row) => row.evidence[0]);
  const invalidRows = [];
  const segments = rows.map((row, index) => {
    const start = starts[index];
    const end =
      index + 1 < rows.length
        ? starts[index + 1]
        : Math.min(start + holdSeconds, duration);
    const reasons = [];
    if (!Number.isFinite(start) || start < 0 || start >= duration)
      reasons.push('invalid_evidence_start');
    if (index && start < starts[index - 1]) reasons.push('out_of_order');
    if (index && start === starts[index - 1]) reasons.push('duplicate_start');
    if (!Number.isFinite(end) || end <= start || end > duration)
      reasons.push('invalid_interval');
    if (reasons.length) invalidRows.push({ row: index, reasons });
    return {
      ...row,
      rowId: `row-${index}`,
      narration: reasons.length ? null : { start, end },
      timingIssues: reasons,
    };
  });
  // A malformed ordering invalidates the interval set; never expose a valid-looking
  // subset that could overlap across rejected rows.
  if (invalidRows.length)
    for (const segment of segments) segment.narration = null;
  return { segments, invalidRows, contractValid: invalidRows.length === 0 };
}

export function similarity(a, b) {
  // Retain numbers and negations; do not erase distinctions such as on/off.
  const tokens = (text) =>
    new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const x = tokens(a);
  const y = tokens(b);
  return x.size + y.size
    ? (2 * [...x].filter((t) => y.has(t)).length) / (x.size + y.size)
    : 0;
}

export function seamPass(segments) {
  const result = [];
  for (const segment of segments) {
    const previous = result.at(-1);
    // Only exact normalized wording is safe enough to auto-merge in the prototype.
    // Near duplicates are measured/reviewed, not silently merged.
    if (
      previous &&
      previous.chunk !== segment.chunk &&
      Math.abs(previous.end - segment.start) <= 0.25 &&
      previous.text.toLowerCase().replace(/\s+/g, ' ').trim() ===
        segment.text.toLowerCase().replace(/\s+/g, ' ').trim()
    ) {
      previous.end = Math.max(previous.end, segment.end);
      previous.evidence = [
        ...new Set([...previous.evidence, ...segment.evidence]),
      ];
      previous.evidenceReferences = [
        ...(previous.evidenceReferences ?? []),
        ...(segment.evidenceReferences ?? []),
      ];
    } else result.push({ ...segment, evidence: [...segment.evidence] });
  }
  return result;
}

export function seamMetric(segments) {
  let seams = 0;
  let duplicates = 0;
  for (let i = 1; i < segments.length; i++) {
    if (segments[i - 1].chunk !== segments[i].chunk) {
      seams++;
      if (similarity(segments[i - 1].text, segments[i].text) >= 0.9)
        duplicates++;
    }
  }
  return {
    seams,
    duplicates,
    fraction: seams ? duplicates / seams : null,
    threshold: 0.9,
  };
}

export function seamPairs(segments) {
  const pairs = [];
  for (let index = 1; index < segments.length; index++) {
    const previous = segments[index - 1];
    const next = segments[index];
    if (previous.chunk === next.chunk) continue;
    pairs.push({
      previous: {
        chunk: previous.chunk,
        evidence: previous.evidence,
        text: previous.text,
      },
      next: { chunk: next.chunk, evidence: next.evidence, text: next.text },
      skippedChunks: Math.max(0, next.chunk - previous.chunk - 1),
      similarity: similarity(previous.text, next.text),
      reviewDecision: null,
    });
  }
  return pairs;
}

export async function runWaves(chunks, width, request, signal) {
  const outputs = [];
  for (let offset = 0; offset < chunks.length; offset += width) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const context = offset ? outputs[offset - 1].slice(-3) : [];
    const wave = chunks.slice(offset, offset + width);
    let firstFailure;
    const settled = await Promise.allSettled(
      wave.map(async (chunk) => {
        try {
          return await request(chunk, context, combined);
        } catch (error) {
          firstFailure ??= error;
          controller.abort(error);
          throw error;
        }
      }),
    );
    signal.throwIfAborted();
    if (firstFailure) throw firstFailure;
    outputs.push(...settled.map((r) => r.value));
  }
  return outputs.flat();
}

async function processOutput(binary, args, signal) {
  const child = spawn(binary, args, {
    signal,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  let error = '';
  child.stdout.on('data', (data) => output.push(data));
  child.stderr.on('data', (data) => {
    error = (error + data).slice(-4000);
  });
  await new Promise((ok, fail) => {
    child.once('error', fail);
    child.once('close', (code) =>
      code === 0 ? ok() : fail(new Error(`${binary} exited ${code}: ${error}`)),
    );
  });
  return Buffer.concat(output);
}

export function budgetSamples(candidates, cap = 600) {
  const selected = new Map();
  for (const sample of candidates) {
    const bucket = Math.floor(sample.time / 10);
    if (!selected.has(bucket) || selected.get(bucket).score < sample.score)
      selected.set(bucket, sample);
  }
  const samples = new Set(selected.values());
  if (candidates[0]) samples.add(candidates[0]);
  if (samples.size > cap)
    throw new Error('Temporal coverage cannot fit the frame cap');
  for (const sample of [...candidates].sort(
    (a, b) => b.score - a.score || a.time - b.time,
  )) {
    if (samples.size >= cap) break;
    samples.add(sample);
  }
  return [...samples].sort((a, b) => a.time - b.time);
}

async function probeSamples(path, threshold, signal) {
  const metadata = JSON.parse(
    (
      await processOutput(
        'ffprobe',
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
        signal,
      )
    ).toString(),
  );
  if (!metadata.streams.some((s) => s.codec_type === 'video'))
    throw new Error('Clip has no video');
  const duration = Number(metadata.format.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 1200)
    throw new Error('Clip must be between 0 and 1200 seconds');
  const child = spawn(
    'ffmpeg',
    [
      '-nostdin',
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      'fps=4,scale=160:90',
      '-pix_fmt',
      'gray',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { signal, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const completion = new Promise((ok, fail) => {
    child.once('error', fail);
    child.once('close', (code) =>
      code === 0 ? ok() : fail(new Error(`Probe decode failed: ${code}`)),
    );
  });
  // Register rejection immediately, including while stdout is still being read.
  completion.catch(() => {});
  child.stderr.resume();
  const candidates = [];
  let pending = Buffer.alloc(0);
  let previous;
  let index = 0;
  let last = -Infinity;
  for await (const data of child.stdout) {
    pending = Buffer.concat([pending, data]);
    while (pending.length >= 14400) {
      const frame = Buffer.from(pending.subarray(0, 14400));
      pending = pending.subarray(14400);
      const time = index++ / 4;
      let score = 0;
      if (previous)
        for (let p = 0; p < frame.length; p++)
          score += Math.abs(frame[p] - previous[p]);
      score /= 14400 * 255;
      if (time < duration && (score >= threshold || time - last >= 2)) {
        candidates.push({ time, score });
        last = time;
      }
      previous = frame;
    }
  }
  await completion;
  // Reserve temporal coverage before ranking, and never drop the tail silently.
  const samples = budgetSamples(candidates);
  return {
    duration,
    candidates: candidates.length,
    samples,
    budget: {
      cap: 600,
      dropped: candidates.length - samples.length,
      reservedCoverageBins: new Set(samples.map((s) => Math.floor(s.time / 10)))
        .size,
      firstSample: samples[0]?.time ?? null,
      lastSample: samples.at(-1)?.time ?? null,
      maximumGapSeconds: Math.max(
        0,
        ...samples.slice(1).map((s, i) => s.time - samples[i].time),
      ),
      tailGapSeconds: duration - (samples.at(-1)?.time ?? 0),
      perMinute: Array.from(
        { length: Math.ceil(duration / 60) },
        (_, i) => samples.filter((s) => Math.floor(s.time / 60) === i).length,
      ),
    },
  };
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) {
    console.log(
      'Phase 0 only. Node >=22.18. Run: node scripts/visual-narration-prototype.mjs manifest.json [--send]\nWithout --send: local sampling estimate only. With --send: sends sampled frames to manifest provider.\nSet KERF_VISION_API_KEY in the environment. Reports: .cache/visual-narration-*/',
    );
    return;
  }
  const manifestPath = resolve(args[0]);
  const config = manifestSchema.parse(
    JSON.parse(await readFile(manifestPath, 'utf8')),
  );
  if (new Set(config.clips.map((c) => c.path)).size !== config.clips.length)
    throw new Error('Each supplied clip must have a distinct path');
  const missingCategories = categories.filter(
    (kind) => !config.clips.some((clip) => clip.kind === kind),
  );
  if (missingCategories.length)
    console.log(
      `Partial quality coverage; missing categories: ${missingCategories.join(', ')}`,
    );
  const send = args.includes('--send');
  let model;
  if (send) {
    if (!config.provider)
      throw new Error('Manifest provider is required with --send');
    const { createLanguageModel } =
      await import('../packages/agent/src/providers.ts');
    model = createLanguageModel({
      ...config.provider,
      label: 'Phase 0',
      baseUrl: config.provider.baseUrl ?? null,
      apiKey: process.env.KERF_VISION_API_KEY ?? null,
    });
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Cancelled'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  await mkdir('.cache', { recursive: true });
  const output = await mkdtemp(resolve('.cache/visual-narration-'));
  const temporary = join(output, 'frames');
  await mkdir(temporary);
  const reports = [];
  try {
    for (const clip of config.clips) {
      controller.signal.throwIfAborted();
      console.log(`Sampling ${clip.kind}...`);
      const path = resolve(dirname(manifestPath), clip.path);
      const samplingStarted = Date.now();
      const sampled = await probeSamples(
        path,
        config.changeThreshold,
        controller.signal,
      );
      const chunks = chunksFor(sampled.samples, sampled.duration);
      const samplingMs = Date.now() - samplingStarted;
      const estimate = {
        kind: clip.kind,
        clip: clip.path,
        duration: sampled.duration,
        candidates: sampled.candidates,
        retainedFrames: sampled.samples.length,
        downsampled: sampled.candidates > sampled.samples.length,
        chunks: chunks.length,
        imagesWithOverlap:
          sampled.samples.length + Math.max(0, chunks.length - 1),
        samplingBudget: sampled.budget,
      };
      reports.push({ ...estimate, samplingOnly: !send });
      console.log(JSON.stringify(estimate));
      if (!send) continue;
      for (const resolution of config.resolutions) {
        const extractionStarted = Date.now();
        const images = new Map();
        for (const sample of sampled.samples) {
          const destination = join(
            temporary,
            `${config.clips.indexOf(clip)}-${resolution}-${sample.time}.jpg`,
          );
          await processOutput(
            'ffmpeg',
            [
              '-nostdin',
              '-v',
              'error',
              '-ss',
              String(sample.time),
              '-i',
              path,
              '-frames:v',
              '1',
              '-vf',
              `scale=${resolution}:${resolution}:force_original_aspect_ratio=decrease`,
              '-q:v',
              '3',
              '-map_metadata',
              '-1',
              '-y',
              destination,
            ],
            controller.signal,
          );
          images.set(sample.time, destination);
        }
        const extractionMs = Date.now() - extractionStarted;
        for (const width of config.widths)
          for (const overlap of config.overlaps) {
            const started = Date.now();
            let completed = 0;
            let inputTokens = 0;
            let outputTokens = 0;
            const { generateText } = await import('ai');
            let raw;
            try {
              raw = await runWaves(
                chunks,
                width,
                async (chunk, context, signal) => {
                  const frames = chunkFrames(chunks, chunk.index, overlap);
                  const content = [
                    {
                      type: 'text',
                      text:
                        'Create concise visual narration for a tutorial. Prioritize meaningful user actions and visible outcomes: commands run, pages opened, settings changed, results shown. Do NOT describe cursor movement, hovers, zooms, loading spinners, or the speaker simply remaining present unless these change the outcome. Merge consecutive micro-steps into one description. Rough target is 4-8 descriptions per minute across the video; allow zero descriptions in chunks without meaningful change and do not invent actions to meet a quota. Describe only visible evidence, never inferred intent or speech. Quote text only when clearly legible and important. Static or black footage must return empty segments, not invented activity. Avoid repeating actions already described in context. Return ONLY one JSON object, no prose or code fences: {"segments":[{"startFrameIndex":0,"endFrameIndex":0,"text":"..."}]}. Indices refer to supplied images; end index is inclusive evidence. Evidence ranges may overlap, but rows must have distinct first frame indices in chronological order. Context-only images establish the starting state: describe changes AFTER that image and never use it as a range endpoint. Secondary terminology context (may precede the immediate prior chunk): ' +
                        JSON.stringify(config.textContext ? context : []),
                    },
                  ];
                  for (let index = 0; index < frames.length; index++)
                    content.push(
                      {
                        type: 'text',
                        text: `Frame ${index}: ${frames[index].time}s, ${frames[index].contextOnly ? 'CONTEXT ONLY' : 'OUTPUT ELIGIBLE'}`,
                      },
                      {
                        type: 'file',
                        data: await readFile(images.get(frames[index].time)),
                        mediaType: 'image/jpeg',
                      },
                    );
                  const result = await generateText({
                    model,
                    messages: [{ role: 'user', content }],
                    maxOutputTokens: config.maxOutputTokens,
                    maxRetries: 0,
                    abortSignal: AbortSignal.any([
                      signal,
                      AbortSignal.timeout(120000),
                    ]),
                  });
                  inputTokens += result.usage.inputTokens ?? 0;
                  outputTokens += result.usage.outputTokens ?? 0;
                  await writeFile(
                    join(
                      output,
                      `${clip.kind}-${config.clips.indexOf(clip)}-${resolution}-${width}-${overlap}-chunk-${chunk.index}-response.json`,
                    ),
                    JSON.stringify(
                      {
                        text: result.text,
                        finishReason: result.finishReason,
                        usage: result.usage,
                      },
                      null,
                      2,
                    ),
                  );
                  const segments = validateSegments(
                    parseResponse(result.text),
                    frames,
                    chunk,
                  );
                  await writeFile(
                    join(
                      output,
                      `${clip.kind}-${config.clips.indexOf(clip)}-${resolution}-${width}-${overlap}-chunk-${chunk.index}.json`,
                    ),
                    JSON.stringify(
                      { clip: clip.path, chunk, frames, segments },
                      null,
                      2,
                    ),
                  );
                  console.log(
                    `${clip.kind} ${resolution}px W=${width} overlap=${overlap}: ${++completed}/${chunks.length}`,
                  );
                  return segments;
                },
                controller.signal,
              );
            } catch (error) {
              controller.signal.throwIfAborted();
              reports.push({
                kind: clip.kind,
                clip: clip.path,
                resolution,
                width,
                overlap,
                verdict: 'GENERATION_FAILED',
                error: error.name,
                completedChunks: completed,
                inputTokens,
                outputTokens,
                elapsedMs: Date.now() - started,
              });
              await writeFile(
                join(output, 'report.json'),
                JSON.stringify(reports, null, 2),
              );
              console.log(
                `Comparison variant failed: ${resolution}px W=${width} overlap=${overlap}, ${error.name}`,
              );
              throw error;
            }
            // Preserve provider/chunk order so ordering defects remain observable.
            const ordered = raw;
            const stitched = seamPass(ordered);
            const timing = deriveNarrationIntervals(
              stitched,
              sampled.duration,
              config.lastHoldSeconds,
            );
            const invalidRanges = timing.invalidRows;
            reports.push({
              kind: clip.kind,
              clip: clip.path,
              duration: sampled.duration,
              samplingMs,
              extractionMs,
              totalRuntimeMs: samplingMs + extractionMs + Date.now() - started,
              descriptions: timing.segments.length,
              descriptionsPerMinute:
                timing.segments.length / (sampled.duration / 60),
              humanTimingWrongRows: null,
              timingReviewStatus: 'UNREVIEWED',
              reviewImages: timing.segments.map((s) => ({
                rowId: s.rowId,
                first: `frames/${config.clips.indexOf(clip)}-${resolution}-${s.evidence[0]}.jpg`,
                last: `frames/${config.clips.indexOf(clip)}-${resolution}-${s.evidence.at(-1)}.jpg`,
                looksWrong: null,
              })),
              invalidRanges,
              verdict: invalidRanges.length
                ? 'TIMING_INVALID_REQUIRES_REVIEW'
                : 'REQUIRES_HUMAN_REVIEW',
              resolution,
              width,
              overlap,
              elapsedMs: Date.now() - started,
              inputTokens,
              outputTokens,
              estimatedUsd: config.prices
                ? (inputTokens * config.prices.input +
                    outputTokens * config.prices.output) /
                  1e6
                : null,
              rawSeams: seamMetric(ordered),
              rawSeamPairs: seamPairs(ordered),
              stitchedSeams: seamMetric(stitched),
              rawSegments: ordered,
              segments: timing.segments,
            });
            await writeFile(
              join(output, 'report.json'),
              JSON.stringify(reports, null, 2),
            );
          }
      }
    }
    await writeFile(
      join(output, 'report.json'),
      JSON.stringify(
        {
          settings: {
            ...config,
            clips: config.clips.map((c) => ({ kind: c.kind })),
          },
          results: reports,
        },
        null,
        2,
      ),
    );
    const lines = [
      '# Phase 0 visual narration review',
      '',
      'Verdict: NOT YET REVIEWED. Compare every row with source footage before advancing.',
      '',
    ];
    for (const report of reports) {
      lines.push(
        `## ${report.kind} ${report.resolution ?? ''} W=${report.width ?? '-'} overlap=${report.overlap ?? '-'}`,
        '',
        '```json',
        JSON.stringify(
          { ...report, rawSegments: undefined, segments: undefined },
          null,
          2,
        ),
        '```',
        '',
      );
      for (const s of report.segments ?? []) {
        const interval = s.narration
          ? `[${s.narration.start.toFixed(2)}, ${s.narration.end.toFixed(2)})`
          : 'INVALID';
        const pictures = report.reviewImages.find(
          (image) => image.rowId === s.rowId,
        );
        lines.push(
          `- ${s.rowId}: narration ${interval}s; evidence ${JSON.stringify(s.evidence)}s: ${s.text} — [first evidence](${pictures.first}), [last evidence](${pictures.last}). Looks wrong: UNREVIEWED.`,
        );
      }
      lines.push(
        '',
        'Reviewer: missed actions / false claims / repeated text / useful? __________',
        '',
      );
    }
    await writeFile(join(output, 'review.md'), lines.join('\n'));
    console.log(`Review artifacts: ${output}`);
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    const key = process.env.KERF_VISION_API_KEY;
    const message = JSON.stringify({
      name: error?.name,
      message: error?.message,
      statusCode: error?.statusCode,
      cause: error?.cause
        ? { name: error.cause.name, message: error.cause.message }
        : undefined,
    });
    console.error(key ? message.split(key).join('[redacted]') : message);
    console.error(
      'Phase 0 failed or was cancelled. No Kerf projects were modified. Check clip paths, provider configuration and structured output.',
    );
    process.exitCode = 1;
  });
}
