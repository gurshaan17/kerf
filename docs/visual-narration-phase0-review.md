# Visual narration: Phase 0 observations

Status: follow-up tasks 1–7 completed at the prototype level. Structural timing, static fixtures, long-run frame cap/runtime, and tutorial density are measured. The gate is **not passed**: draft ground truth needs user review, four sampled alignment flags need decisions, and monetary rates remain unset. Subsequent implementation is documented in [Visual narration](visual-narration.md); it preserves the draft/review boundary and does not change these quality findings.

## Inputs and setup

Used the four user-supplied files in `muted-clips/`, with Kerf's enabled Google Gemini account (`gemini-3.8-flash`). All four files have a video stream and no audio stream. The saved credential was decrypted using Electron safeStorage into memory and passed to the runner's child environment; no plaintext credential was written to reports or project files.

Baseline: 1280px long edge, visual-change sampling at 4 probe frames/second, W=3, overlap context frames enabled, 2400 output-token limit per call. Reports remain local in `.cache/visual-narration-z83zte/`. Source videos and frame images are not included in this document. Generated descriptions were read and spot-checked against source contact sheets and individual frames; this was not an exhaustive frame-by-frame accuracy benchmark.

## Baseline results

| Clip                | Duration | Primary samples | Chunks | Descriptions | Invalid timing rows | Generation time |
| ------------------- | -------: | --------------: | -----: | -----------: | ------------------: | --------------: |
| muted-screen.mp4    |  121.20s |              79 |     11 |           26 |                  12 |           79.6s |
| muted-testpilot.mp4 |   73.97s |              80 |     10 |           24 |                   1 |           77.3s |
| muted.mp4           |   18.23s |              48 |      6 |           16 |                   0 |           31.7s |
| muted1.mp4          |  121.37s |              77 |     10 |           37 |                   8 |           96.4s |

Generation time excludes probing and extraction. Total reported usage for these four completed runs: 361,015 input tokens and 35,499 output tokens. Dollar cost was not estimated because no verified token prices were supplied. Failed setup requests are not included in these usage totals.

All four baseline runs measured zero near-identical adjacent descriptions across chunk seams at a normalized token similarity threshold of 0.9. This narrow lexical metric does not prove semantic repetition is absent.

## Review findings

The walkthrough descriptions are specific enough to justify further prototype work. The screen recording describes sign-in, dashboard loading, contact management, Brand Kit, MCP, and automation creation. The TestPilot clip describes `npm test`, Jest test results, `npm run demo`, and opening a report. These are concrete steps rather than generic descriptions of a computer screen.

The short portrait video captures several quick B-roll cuts: a phone call, typing, a vehicle scene, and a building exterior. Contact sheets and a full-size source frame at 6.5s confirmed the outdoor laptop scene. The longer portrait video's descriptions read changing numbered tips and graphic overlays, including the content funnel and call-to-action cards. These are visual narration drafts; the original spoken words cannot be recovered reliably from these muted files. Burned-in text is not a substitute for a complete speech transcript.

Timing is a release blocker. In three runs, generated evidence intervals overlap because adjacent descriptions share sampled frames. Mapping inclusive evidence endpoints directly to narration timing therefore produces overlapping caption intervals. Those rows are flagged in the prototype report, not accepted as a valid app transcript. Preserve evidence separately and test a stricter disjoint narration interval contract before persistence or captions work.

The prompt also over-describes cursor movement, hovers, zooms, loading states, and the speaker's continued presence. A useful tutorial draft should prioritize meaningful actions and visible outcomes. Validate that change with the same footage before broadening implementation.

Two setup issues were found: unconstrained output may be wrapped in a JSON code fence, and this configured Gemini Interactions route returned HTTP 400 for the SDK's schema-constrained request. The runner now accepts a single JSON object, either raw or inside one complete JSON fence, then performs strict schema/frame-reference validation. It does not salvage prose or silently switch providers.

## Controlled comparison

Used a 30-second excerpt from `muted-testpilot.mp4`, with 32 identical primary samples and four chunks in every run. Completed reports are in `.cache/visual-narration-rC8Zen/`. The comparison used an 8192 output-token limit after an earlier attempt returned incomplete JSON. Raw responses and finish reasons are retained for diagnosis. Do not compare these runtimes directly with the full-clip baseline.

| Resolution |   W | Overlap | Descriptions | Invalid timing rows | Generation time |
| ---------- | --: | ------- | -----------: | ------------------: | --------------: |
| 768        |   1 | Off     |           15 |                   5 |           73.9s |
| 768        |   1 | On      |           11 |                   2 |           50.4s |
| 768        |   3 | Off     |           11 |                   3 |           34.6s |
| 768        |   3 | On      |           10 |                   1 |           37.2s |
| 1280       |   1 | Off     |           12 |                   3 |           65.8s |
| 1280       |   1 | On      |           11 |                   4 |           68.5s |
| 1280       |   3 | Off     |           10 |                   1 |           30.0s |
| 1280       |   3 | On      |            9 |                   1 |           31.9s |

Every variant included `git diff`, `npm test`, and `npm run demo` in its descriptions. The source frames support those actions. There was no clear resolution advantage for those command labels in this excerpt; this does not establish that 768px is adequate for dense UI text generally. All eight runs produced some timing overlap, so changing resolution or concurrency alone does not fix timing.

Each run measured 0/3 near-identical seam pairs at threshold 0.9. W=3 was faster in these single runs, with varying description counts and wording. This is not a repeated statistical latency study. Text continuity context remained enabled; these experiments do not isolate overlap frames alone or justify dropping the text-context dependency. The runner now supports `textContext: false` for that follow-up experiment. A static or deliberately repetitive clip would provide a more discriminating seam test.

Reported comparison usage: 304,368 input tokens and 32,082 output tokens, excluding earlier failed experiments. Actual currency cost remains unknown without verified rates.

## Initial gaps before the follow-up tasks

The supplied files cover screen walkthroughs and camera footage. No true static clip or 10–20 minute clip was supplied, so hallucination on static footage, long-media sampling coverage, and long-run performance remain unproven.

Before infrastructure work, revise the narration timing contract so overlapping evidence does not become overlapping captions, tighten the prompt to prioritize meaningful steps over cursor/zoom commentary, and rerun the same clips. Keep evidence intervals independently inspectable; do not silently trim timing conflicts and count them as validated output. Add static and long-media samples before claiming those cases work. The supplied TestPilot footage includes rapid visual transitions but does not establish robustness on every rapid-click UI sequence.

No project database, timeline, captions, or source files were modified by these experiments. The Phase 0 runner's local diagnostics deliberately retain invalid timing for review; those results are not accepted as app transcripts.

## Follow-up task 1: separate evidence and narration intervals

Added a pure `deriveNarrationIntervals` function. Evidence frame times and chunk-local index references remain intact and may overlap. Each narration interval starts at its first evidence frame and ends at the next row's first evidence frame; the final row uses a configurable hold, default 3s, capped at clip duration. Reversed, equal, missing, or out-of-bounds starts are flagged without sorting. An invalid interval set is rejected rather than exposing a potentially overlapping valid-looking subset. The report stores evidence and narration independently.

Eight runner tests pass, including disjoint timing with overlapping evidence, configurable final hold, empty results, reversed/duplicate starts, immutable inputs, deterministic context, and cancellation/failure. Reports include row IDs and first/last evidence-image links for manual review. Invalid-row counts and human timing-incorrect counts are separate; human counts remain unknown until a named review is recorded.

`.cache` is git-ignored; `fixtures` is not. All new fixtures, frame images, and experiment outputs use `.cache` exclusively. App schemas, queue, DB, IPC, UI, project files, timeline, captions, and original source files are outside this work.

## Follow-up task 2: narration prompt and density

The prompt prioritizes commands, page changes, settings changes, and visible results. It suppresses cursor movement, hovers, zooms, spinners, and continued speaker presence unless they affect the outcome, and asks for consecutive micro-steps to be merged. It permits empty chunks and empty static output, quotes only legible important text, and forbids inferred speech/intent. It asks for distinct chronological evidence starts. Descriptions/minute is measured against a rough 4–8/min tutorial target; the runner does not manufacture or delete rows to hit it.

## Follow-up task 3: four original clips rerun

Completed a single rerun of each original clip at 1280px, W=3, visual-change sampling, overlap on, text context on, 3s final hold, and the revised prompt. The output limit is 8192, matching the completed earlier comparison, rather than the original baseline's 2400. The hold rule is deterministic and evidence is not trimmed. Full rows, raw responses, evidence references, and first/last frame links are local in `.cache/visual-narration-lMjA08/report.json` and `review.md`. Human timing-incorrect counts are unknown pending review; they are separate from invalid interval counts.

| Clip                | Descriptions old → new | New / min | Invalid intervals old → new | Generation old → new | New input / output tokens |
| ------------------- | ---------------------: | --------: | --------------------------: | -------------------: | ------------------------: |
| muted-screen.mp4    |                26 → 14 |      6.93 |                      12 → 0 |         79.6 → 78.7s |          102,633 / 10,492 |
| muted-testpilot.mp4 |                 24 → 8 |      6.49 |                       1 → 0 |         77.3 → 96.3s |           102,004 / 8,761 |
| muted.mp4           |                 16 → 4 |     13.16 |                       0 → 0 |         31.7 → 68.5s |            60,875 / 6,252 |
| muted1.mp4          |                37 → 28 |     13.84 |                       8 → 0 |         96.4 → 88.4s |           100,028 / 8,827 |

Both screen recordings meet the 4–8/min target in this single rerun. The camera clips are denser; no quota was imposed. Old invalid counts refer to the previous evidence-as-timing contract, so the new zero counts establish structural timing validity, not human-confirmed synchronization. Provider input volume remains similar because frame sampling did not change; these data do not establish a cost or latency saving from the tighter prompt.

For alignment inspection, `.cache/phase0-v2/timing-review/spotchecks.json` lists 12 sampled rows (first/middle/last per clip), with start/mid/end source snapshots and per-clip 3×3 contact sheets. Assistant inspection flagged 4/12 for user review: TestPilot row-7 ends before the proposed-fix portion appears; montage row-3 extends into the returned interview shot; portrait row-0 holds after the graphic changes; portrait row-14 holds into the UTM graphic. DMflo had 0/3 assistant flags, TestPilot 1/3, montage 1/3, and portrait 2/3. These are sample-based flags, not a human-approved error rate. User `looksWrong` fields and human error counts remain null. No timing was changed to conceal these findings.

## Follow-up task 4: static and long fixtures

Generated all fixtures under ignored `.cache/phase0-v2/fixtures/`: 15s black from ffmpeg's lavfi color source, a screenshot of the DMflo dashboard held for 30s with `-loop 1`, and a 14m 1.17s concatenation of the two supplied screen recordings. The long fixture repeats the normalized two-recording sequence four times, then appends the first 60s of DMflo. Source recordings were read only. Normalized copies use 1280×720, 12fps, H.264; `chapters.json` records exact offsets. Fixture construction took 14.3s, excluded from runner runtimes below. Fixture contact sheets were inspected; the held screenshot is genuinely unchanged, not a cursor-blink/noise stress test.

Completed single runs, same settings as task 3. Local reports/frames: `.cache/visual-narration-hvodkh/`.

| Fixture             |  Descriptions | Invalid intervals | Total runner time | Generation time | Input / output tokens |
| ------------------- | ------------: | ----------------: | ----------------: | --------------: | --------------------: |
| Black 15s           |             0 |                 0 |             9.42s |           8.81s |          10,481 / 231 |
| Held screenshot 30s |             0 |                 0 |            13.48s |          12.20s |          19,619 / 700 |
| Long 841.17s        | 96 (6.85/min) |                 0 |           700.55s |         654.17s |      794,059 / 70,365 |

Neither static fixture produced an invented action in these runs. Long sampling took 2.69s and frame extraction 43.69s; total time includes both plus generation/report work. No provider fallback or retry was used.

The long sampler generated 668 candidates and kept exactly 600 unique primary frames, with 684 submitted images including overlap copies across 85 chunks. The deterministic budget first reserves the highest-scoring candidate in each 10-second bin plus the first frame, then fills remaining slots by change score with chronological tie-breaking. It dropped 68 candidates and covered all 85 occupied time bins, starting at 0s and ending at 840.75s (0.417s tail gap). Largest inter-sample gap: 12s. Retained per-minute distribution: `[31,33,60,40,32,56,51,21,55,58,24,42,65,31,1]`. This demonstrates coverage and the hard cap, not preservation of every brief interaction. A pure over-budget selection test verifies cap, deterministic output, temporal coverage, and rejection if coverage cannot fit.

Monetary cost is still unknown; task 7 supplies explicit pricing placeholders and recomputation. Long narration intervals are structurally valid, but exhaustive human alignment and ground-truth recall remain unverified.

## Follow-up task 5: text-context ablation

Compared matching single runs at 1280px, W=3, overlap on: text-context-enabled results from tasks 3/4 against new `textContext:false` runs in `.cache/visual-narration-K0WjYb/`. This reuses the earlier enabled trials rather than pretending to be a randomized/repeated experiment. Same samples, prompt, final hold, and output-token limit.

| Clip            | Text context | Descriptions | / min | Invalid intervals |     Seam pairs ≥0.9 | Generation |
| --------------- | ------------ | -----------: | ----: | ----------------: | ------------------: | ---------: |
| Held screenshot | On           |            0 |     0 |                 0 | No pairs; undefined |     12.20s |
| Held screenshot | Off          |            0 |     0 |                 0 | No pairs; undefined |     13.91s |
| TestPilot       | On           |            8 |  6.49 |                 0 |                 0/6 |     96.29s |
| TestPilot       | Off          |            9 |  7.30 |                 0 |                 0/6 |     94.59s |

All adjacent description pairs across chunk boundaries, exact texts/evidence times, skipped chunks, similarity scores, and blank review decisions are in `.cache/phase0-v2/ablation/seam-pairs.json` and `.md`. Assistant reading found no obvious static duplication in the walkthrough pairs. Returning from the report to the terminal and opening the report again is a visible repeated action, not automatically a duplicate. The lexical metric alone cannot make that distinction.

Plain conclusion: overlap frames alone were sufficient on these two fixtures to avoid observed seam repetition and static invented actions. General sufficiency is unproven: one fixture has no descriptions, and this is one walkthrough trial per setting. Do not remove the text-context option/default on this evidence. The 102,004 vs 101,563 input-token counts and 8,761 vs 4,814 output-token counts are measured observations, not a causal savings claim; provider output varies.

## Follow-up task 6: draft ground truth and deterministic scoring

Drafts and source contact sheets are in `.cache/phase0-v2/ground-truth/`, indexed by `index.json`. Each clip folder contains `ground_truth.json`, approximate timestamps, per-action full-size source images, and a contact sheet. Action clips have 9–14 expected actions. The static fixtures intentionally have zero expected actions plus five static-review checks; adding 5–15 fictional actions to static ground truth would be incorrect. Every file is clearly `DRAFT_NEEDS_REVIEW`, based on assistant-selected source frames rather than independent human annotations. Some snapshots precede the outcome being labeled, so approximate timestamps and tolerances specifically need your correction.

`scripts/score-visual-narration.mjs` uses a simple rule, not an LLM judge: normalize case/punctuation, match an AND group of whole phrases with OR alternatives, and require the description's evidence window to intersect the expected timestamp ± tolerance. Default tolerance is 5s, with 1.5s for montage actions and 8s for long-fixture markers. Aliases are editable through `matchAny`. A single description can cover multiple actions. This is a limited keyword matcher; synonyms or missing aliases can create false misses.

| Clip / trial                        | Draft hits | Provisional recall | Unmatched descriptions needing review |
| ----------------------------------- | ---------: | -----------------: | ------------------------------------: |
| DMflo                               |      12/13 |              92.3% |                                     2 |
| TestPilot, context on               |        9/9 |               100% |                                     1 |
| Montage                             |        8/9 |              88.9% |                                     0 |
| Longer portrait                     |      10/10 |               100% |                                    17 |
| Long concatenation                  |      14/14 |               100% |                                    82 |
| TestPilot, context off              |        8/9 |              88.9% |                                     2 |
| Static fixtures, both context modes |        0/0 |     Not applicable |                                     0 |

The DMflo draft miss is the 404 state; the montage draft miss is the earlier money/cash B-roll. The context-off TestPilot draft miss is explicit passing-test output. These misses require checking the annotations and keyword aliases before treating them as model errors. All formal recall verdicts are `UNKNOWN_DRAFT_GROUND_TRUTH`, even though provisional numbers exceed the default 80% bar. Set a corrected file's `reviewStatus` to `REVIEWED` only after source review; `--bar` changes the recall threshold.

`.cache/phase0-v2/scores.json` contains action hits and row IDs plus `hallucinationReviewCandidates` with blank decisions. Unmatched rows are not counted as wrong: the draft samples only 14 markers from 96 long-video descriptions, so most legitimate unannotated steps naturally appear in that list. Confirmed hallucination counts remain null until reviewed.

## Follow-up task 7: measured token density and explicit prices

Added `.cache/phase0-v2/prices.json` with null currency, input-per-million-token, and output-per-million-token placeholders. No price is assumed or fetched. The scoring report now includes input/output/total tokens per minute, monetary cost/minute, total cost, and projected cost for a 20-minute video once valid rates and currency are present. All monetary fields currently remain null (`UNKNOWN_FILL_PRICES_JSON`).

| Clip / trial                 | Input tokens/min | Output tokens/min | Total tokens/min | Cost/min / 20-minute cost |
| ---------------------------- | ---------------: | ----------------: | ---------------: | ------------------------- |
| DMflo, context on            |         50,807.7 |           5,194.0 |         56,001.7 | Unknown / unknown         |
| TestPilot, context on        |         82,742.9 |           7,106.7 |         89,849.5 | Unknown / unknown         |
| Montage                      |        200,319.9 |          20,573.3 |        220,893.2 | Unknown / unknown         |
| Longer portrait              |         49,450.7 |           4,363.8 |         53,814.5 | Unknown / unknown         |
| Black 15s                    |         41,924.0 |             924.0 |         42,848.0 | Unknown / unknown         |
| Held screenshot, context on  |         39,238.0 |           1,400.0 |         40,638.0 | Unknown / unknown         |
| Long concatenation           |         56,639.8 |           5,019.1 |         61,658.9 | Unknown / unknown         |
| Held screenshot, context off |         39,238.0 |           1,172.0 |         40,410.0 | Unknown / unknown         |
| TestPilot, context off       |         82,385.1 |           3,905.0 |         86,290.1 | Unknown / unknown         |

Cost/minute is `(inputTokensPerMinute * inputRate + outputTokensPerMinute * outputRate) / 1,000,000`. The 20-minute figure is a **linear projection at the measured token density**, not a rerun or a budget-aware forecast. For a high-density short montage, the 600-frame cap would change the actual sampling density on a 20-minute input. Provider cache discounts, pricing tiers, failed/aborted-call charges, and other billing rules are not modeled. Supply verified effective rates; the result is a projection, not an invoice.

After correcting draft actions/timestamps/aliases and marking reviewed truth files `REVIEWED`, or filling prices, recompute entirely locally with no new provider calls:

```sh
node scripts/score-visual-narration.mjs \
  --truth .cache/phase0-v2/ground-truth \
  --prices .cache/phase0-v2/prices.json \
  --bar 0.8 \
  --out .cache/phase0-v2/scores.json \
  .cache/visual-narration-lMjA08/report.json \
  .cache/visual-narration-hvodkh/report.json \
  .cache/visual-narration-K0WjYb/report.json
```

## Verification and review entry points

Detailed artifacts are in ignored `.cache`: `phase0-v2/ground-truth/index.json`, `phase0-v2/timing-review/spotchecks.json` and the corresponding contact sheets, `phase0-v2/ablation/seam-pairs.md`, `phase0-v2/prices.json`, and `phase0-v2/scores.json`. The three run directories above retain raw responses, evidence-frame references, derived intervals, and images. Human timing-error and confirmed-hallucination counts are deliberately unset. Each observation is a single run, not a statistical quality estimate.

An independent local timing audit recomputed intervals for all 9 completed follow-up trials: **159 rows, 0 invalid rows, 0 overlaps**. Evidence and narration remain separate. `.cache/phase0-v2/timing-audit.json` records per-trial counts. All **14 tests pass**, covering interval rejection rather than silent repair, bounded hold, cap/coverage, strict JSON handling, wave cancellation/failure, seam review, time-aware keyword scoring, draft-vs-reviewed recall, threshold boundaries, and explicit/unknown pricing; targeted lint and formatting checks also pass. All four original source SHA-256 hashes and sizes were checked unchanged. Only runner/scoring code, tests, this observations doc, and ignored experiment artifacts were changed; app schemas, queue, database, IPC, UI, projects, timeline, and captions were not modified.

## Exit criteria after the follow-up

Overall verdict: **NOT PASSED / awaiting review and prices**. Structural validity does not establish alignment quality. Four assistant flags from 12 sampled rows remain open; user-confirmed timing-error counts are unknown. All draft recalls exceed the default 80% bar, but draft annotations cannot certify recall.

| Exit criterion                                                           | Status                                       | Evidence and remaining limit                                                                                                                |
| ------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Zero timing overlaps under the new contract, with sampled rows checked   | **UNKNOWN overall; structural check passes** | 0 invalid/overlapping intervals in 159 rows; 12 rows source-checked, 4 assistant alignment flags await user decisions.                      |
| Key-action recall against ground truth, default 80%                      | **UNKNOWN**                                  | Provisional action-clip recalls 88.9–100%; all truth files remain DRAFT_NEEDS_REVIEW.                                                       |
| Static clips: no invented actions                                        | **PASS for these single trials**             | Black and held screenshot returned 0 rows; held screenshot also returned 0 without text context.                                            |
| Long clip completes within frame cap, with measured runtime and cost/min | **UNKNOWN overall; execution check passes**  | 841.17s video completed in 700.55s total, 600/600 frames, 61,658.9 tokens/min; monetary cost/min remains unknown until prices are supplied. |
| Screen recordings within roughly 4–8 descriptions/min                    | **PASS for measured trials**                 | DMflo 6.93, TestPilot 6.49 (7.30 without text context), long concatenation 6.85.                                                            |
