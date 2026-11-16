# AI editing baseline results

Status: **NOT MEASURED**. Protocol and workbook prepared on 17 November 2026.
No manual session or provider request has been run for this evaluation.

Follow the [baseline protocol](ai-editing-baseline.md). Keep private run copies,
media, and evidence in `.cache/ai-editing-baseline/` (ignored by git). Publish
only reviewed, sanitized summaries here. Never turn pending cells into zeroes.

## Input readiness

| Project alias | Representative content                           | Source fingerprints / starting state                                                 | Ready |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ | ----- |
| TH            | Talking-head speech with pauses                  | Pending source selection                                                             | No    |
| SR            | Screen recording with an identifiable task       | Desktop recordings offered; macOS denied directory access, including outside sandbox | No    |
| MX            | Mixed footage with speech and supporting visuals | Pending source selection                                                             | No    |

Desktop recordings alone do not establish talking-head or mixed-footage coverage.
Copy accessible sources locally, inspect their streams and content, then freeze
the three project inputs before making provider requests.

## Trial register

A = edit/reopen/follow-up. B = analysis/reopen/review/apply/undo.
Each row gets its own completed run record using the template below.

| Trial | Before phases 1–3 | After phases 1–3 | Paired verdict |
| ----- | ----------------- | ---------------- | -------------- |
| TH-A  | Pending           | Pending          | Unknown        |
| TH-B  | Pending           | Pending          | Unknown        |
| SR-A  | Pending           | Pending          | Unknown        |
| SR-B  | Pending           | Pending          | Unknown        |
| MX-A  | Pending           | Pending          | Unknown        |
| MX-B  | Pending           | Pending          | Unknown        |

## Run record template

Copy this section into a local Markdown file for each trial, then summarize
reviewed results above. Use `unknown` for unobservable metrics, `not observed`
for a journey branch that did not happen, and `not applicable` with a reason.

```text
Trial / before-or-after / repetition:
UTC date / reviewer:
Application commit / OS / hardware:
Local project alias / initial revision / selected clip IDs:
Source aliases / SHA-256 hashes / durations:
Transcript and index readiness / cache policy:
Chat provider kind / model / available parameters:
Analysis provider kind / model / available parameters:
Consent settings:
Exact initial prompt:
Exact follow-up prompt / duration targets:
Predeclared acceptance criteria / maximum journey time (15 minutes):

Initial Send UTC / acceptance UTC / time to accepted cut (s):
Follow-up Send UTC / acceptance UTC / follow-up time (s):
Total journey elapsed (s) / app-closed time (s):
Acceptance verdict / reviewer reason:
Repeated instruction count / turn IDs:
Duplicate analysis count / paired job IDs:
Explicit retry count / reasons:
Correction turns / discretionary undo count:
Scripted verification undo count / exact restoration observed:
Applied proposal IDs / output clip IDs / affected command IDs:
Unrelated clips preserved:
Response-end and job-end timestamps / asynchronous branch observed:
Result visibility after reopen / recovery steps:
Repeat Apply attempted / duplicate output observed:
Reopen provider request count / observation coverage:
Draft preserved / reader position preserved / concurrent Send blocked:

Provider request observation source / time window / coverage limits:
Actual request count (include observable failed/cancelled attempts):
Per-request provider / model / purpose / elapsed seconds / outcome:
Tool durations (separate from request latency):
Local evidence ledger location:
Confounders / failures / unavailable metrics:
```

Event ledger columns:

```text
UTC | elapsed seconds | turn/job/proposal/output ID | action | observation | evidence
```

## Comparison and completion

For each matched trial, report before and after values and the absolute change
for accepted-cut time, follow-up time, repeated instructions, duplicate analyses,
corrections, discretionary undo, and actual provider requests. Compare request
latencies only when their purpose and observation coverage match. Include failed
and timed-out trials even when timing deltas cannot be computed. Acceptance is a
human verdict, independent of workflow test passes.

- [ ] Three source/project starting states frozen with hashes and exact prompts.
- [ ] Six baseline trials observed and evidence recorded.
- [ ] Reviewer verdicts and measurement gaps recorded for every trial.
- [ ] Baseline locked before phase 1 application changes.
- [ ] Six paired trials repeated after phases 1–3.
- [ ] Confounders, failures, and paired results reviewed separately from tests.

Phase 0 remains pending until the first four items are complete. The final two
items belong to the later release evaluation.
