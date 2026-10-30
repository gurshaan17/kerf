import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreActions, measureCost } from './score-visual-narration.mjs';

test('pricing stays unknown for placeholders and computes explicit supplied rates', () => {
  const run = { duration: 120, inputTokens: 2000, outputTokens: 1000 };
  const missing = measureCost(run, {
    currency: null,
    inputPerMillionTokens: null,
    outputPerMillionTokens: null,
  });
  assert.equal(missing.totalTokensPerMinute, 1500);
  assert.equal(missing.costPerMinute, null);
  assert.equal(missing.projected20MinuteCost, null);
  // Synthetic arithmetic fixture rates, not model pricing.
  const priced = measureCost(run, {
    currency: 'TEST_UNITS',
    inputPerMillionTokens: 2,
    outputPerMillionTokens: 4,
  });
  assert.equal(priced.totalCost, 0.008);
  assert.equal(priced.costPerMinute, 0.004);
  assert.equal(priced.projected20MinuteCost, 0.08);
  assert.throws(() => measureCost({ ...run, duration: 0 }));
});

test('recall requires phrase and time match; unmatched rows are not auto-labeled hallucinations', () => {
  const truth = {
    clip: 'demo.mp4',
    reviewStatus: 'DRAFT_NEEDS_REVIEW',
    actions: [
      {
        id: 'test',
        description: 'Run tests',
        timeSeconds: 10,
        toleranceSeconds: 2,
        matchAny: [['npm test'], ['test suite']],
      },
      {
        id: 'report',
        description: 'Open report',
        timeSeconds: 30,
        matchAny: [['report']],
      },
    ],
  };
  const result = scoreActions(
    {
      segments: [
        {
          text: 'Run npm test.',
          evidence: [9, 11],
          narration: { start: 9, end: 15 },
        },
        {
          text: 'An unmatched but possibly correct action',
          evidence: [20],
          narration: { start: 20, end: 23 },
        },
        {
          text: 'Open report',
          evidence: [100],
          narration: { start: 100, end: 103 },
        },
      ],
    },
    truth,
  );
  assert.equal(result.recall, 0.5);
  assert.equal(result.recallVerdict, 'UNKNOWN_DRAFT_GROUND_TRUTH');
  assert.equal(result.hallucinationReviewCandidates.length, 2);
  assert.equal(result.confirmedHallucinations, null);
  assert.equal(result.hallucinationReviewCandidates[0].reviewDecision, null);
});

test('empty static ground truth has no invented expected actions and no 100% recall claim', () => {
  const result = scoreActions(
    { segments: [] },
    {
      clip: 'black.mp4',
      reviewStatus: 'REVIEWED',
      expectedNoVisibleChange: true,
      actions: [],
    },
  );
  assert.equal(result.recall, null);
  assert.equal(result.recallVerdict, 'NOT_APPLICABLE');
});

test('reviewed recall uses the configured bar including exactly 80 percent', () => {
  const actions = Array.from({ length: 5 }, (_, i) => ({
    id: `a${i}`,
    description: `Action ${i}`,
    timeSeconds: 1,
    matchAny: [[`action${i}`]],
  }));
  const run = {
    segments: actions
      .slice(0, 4)
      .map((a, i) => ({ text: `action${i}`, evidence: [1] })),
  };
  const truth = { clip: 'demo.mp4', reviewStatus: 'REVIEWED', actions };
  assert.equal(scoreActions(run, truth).recallVerdict, 'PASS');
  assert.equal(scoreActions(run, truth, 0.81).recallVerdict, 'FAIL');
});
