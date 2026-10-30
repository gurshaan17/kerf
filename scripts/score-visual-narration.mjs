// Phase 0 only: local deterministic scoring. No provider calls or project writes.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const truthSchema = z.object({
  clip: z.string(),
  reviewStatus: z.enum(['DRAFT_NEEDS_REVIEW', 'REVIEWED']),
  expectedNoVisibleChange: z.boolean().default(false),
  actions: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      timeSeconds: z.number().nonnegative(),
      toleranceSeconds: z.number().nonnegative().default(5),
      matchAny: z.array(z.array(z.string().min(1)).min(1)).min(1),
    }),
  ),
});
const normalize = (text) =>
  String(text)
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(' ') ?? '';

export function measureCost(run, prices = null) {
  const minutes = run.duration / 60;
  if (!Number.isFinite(minutes) || minutes <= 0)
    throw new Error('Cost measurement needs a positive video duration');
  const priced =
    typeof prices?.currency === 'string' &&
    prices.currency.length > 0 &&
    Number.isFinite(prices.inputPerMillionTokens) &&
    prices.inputPerMillionTokens >= 0 &&
    Number.isFinite(prices.outputPerMillionTokens) &&
    prices.outputPerMillionTokens >= 0;
  const totalCost = priced
    ? (run.inputTokens * prices.inputPerMillionTokens +
        run.outputTokens * prices.outputPerMillionTokens) /
      1e6
    : null;
  return {
    videoMinutes: minutes,
    inputTokensPerMinute: run.inputTokens / minutes,
    outputTokensPerMinute: run.outputTokens / minutes,
    totalTokensPerMinute: (run.inputTokens + run.outputTokens) / minutes,
    currency: priced ? prices.currency : null,
    totalCost,
    costPerMinute: priced ? totalCost / minutes : null,
    projected20MinuteCost: priced ? (totalCost / minutes) * 20 : null,
    priceStatus: priced
      ? 'USER_SUPPLIED_RATES_PROJECTION_NOT_AN_INVOICE'
      : 'UNKNOWN_FILL_PRICES_JSON',
    caveat:
      "Linear projection at this run's token density. Frame-cap changes, cached-input discounts, pricing tiers, failed/aborted calls and other provider charges are not modeled.",
  };
}

export function scoreActions(run, truth, bar = 0.8) {
  truth = truthSchema.parse(truth);
  const rows = run.segments;
  const matchedRows = new Set();
  const actions = truth.actions.map((action) => {
    const matchingRows = [];
    rows.forEach((row, index) => {
      const times = row.evidence;
      const first = Math.min(...times);
      const last = Math.max(...times);
      const timeMatches =
        last >= action.timeSeconds - action.toleranceSeconds &&
        first <= action.timeSeconds + action.toleranceSeconds;
      const text = ` ${normalize(row.text)} `;
      const wordsMatch = action.matchAny.some((group) =>
        group.every((phrase) => text.includes(` ${normalize(phrase)} `)),
      );
      if (timeMatches && wordsMatch) {
        matchingRows.push(row.rowId ?? `row-${index}`);
        matchedRows.add(index);
      }
    });
    return { ...action, hit: matchingRows.length > 0, matchingRows };
  });
  const hits = actions.filter((action) => action.hit).length;
  const recall = actions.length ? hits / actions.length : null;
  const candidates = rows.flatMap((row, index) => {
    if (matchedRows.has(index)) return [];
    if (
      truth.expectedNoVisibleChange &&
      [
        'no visible change',
        'no visible changes',
        'the scene remains unchanged',
      ].includes(normalize(row.text))
    )
      return [];
    return [
      {
        rowId: row.rowId ?? `row-${index}`,
        text: row.text,
        evidence: row.evidence,
        narration: row.narration,
        reviewDecision: null,
        status: 'NEEDS_REVIEW_NOT_AUTOMATIC_HALLUCINATION',
      },
    ];
  });
  return {
    clip: truth.clip,
    truthStatus: truth.reviewStatus,
    matchingRule:
      'AND of normalized whole phrases within an OR group; evidence window intersects expected timestamp +/- tolerance. No LLM judge.',
    expectedActions: actions.length,
    hits,
    recall,
    recallBar: bar,
    recallVerdict:
      truth.reviewStatus !== 'REVIEWED'
        ? 'UNKNOWN_DRAFT_GROUND_TRUTH'
        : recall === null
          ? 'NOT_APPLICABLE'
          : recall >= bar
            ? 'PASS'
            : 'FAIL',
    provisionalMeetsBar: recall === null ? null : recall >= bar,
    actions,
    hallucinationReviewCandidates: candidates,
    confirmedHallucinations: null,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      truth: { type: 'string' },
      out: { type: 'string' },
      bar: { type: 'string', default: '0.8' },
      prices: { type: 'string' },
    },
  });
  if (!values.truth || !positionals.length)
    throw new Error(
      'Usage: node scripts/score-visual-narration.mjs --truth DIR [--bar 0.8] [--prices FILE] [--out FILE] report.json ...',
    );
  const bar = Number(values.bar);
  if (!Number.isFinite(bar) || bar < 0 || bar > 1)
    throw new Error('Recall bar must be between 0 and 1');
  const truths = [];
  const prices = values.prices
    ? JSON.parse(await readFile(values.prices, 'utf8'))
    : null;
  for (const entry of await readdir(values.truth, { withFileTypes: true })) {
    if (entry.isDirectory())
      truths.push(
        truthSchema.parse(
          JSON.parse(
            await readFile(
              join(values.truth, entry.name, 'ground_truth.json'),
              'utf8',
            ),
          ),
        ),
      );
  }
  const scored = [];
  for (const file of positionals) {
    const report = JSON.parse(await readFile(file, 'utf8'));
    const results = Array.isArray(report) ? report : report.results;
    for (const run of results) {
      if (!run.segments) continue;
      const truth = truths.find((t) => basename(t.clip) === basename(run.clip));
      if (!truth) throw new Error(`No ground truth for ${basename(run.clip)}`);
      scored.push({
        report: resolve(file),
        ...scoreActions(run, truth, bar),
        cost: measureCost(run, prices),
      });
    }
  }
  const out =
    values.out ?? join(dirname(resolve(positionals[0])), 'scores.json');
  await writeFile(
    out,
    JSON.stringify(
      {
        provisional: scored.some((run) => run.truthStatus !== 'REVIEWED'),
        runs: scored,
      },
      null,
      2,
    ),
  );
  for (const run of scored)
    console.log(
      `${basename(run.clip)}: ${run.hits}/${run.expectedActions}, recall=${run.recall ?? 'N/A'}, ${run.recallVerdict}; ${run.hallucinationReviewCandidates.length} unmatched rows need review`,
    );
  console.log(`Scoring report: ${out}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
