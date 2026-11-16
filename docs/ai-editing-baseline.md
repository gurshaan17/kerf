# AI editing baseline protocol

Phase 0 establishes a repeatable manual comparison before editing continuity
changes. Protocol prepared on 17 November 2026; measurements are pending.
Passing automated tests does not establish editorial quality.

## Stage A: freeze the inputs

Use three real projects: talking-head speech with pauses, a screen recording
with an identifiable task, and mixed footage with speech and supporting visuals.
Choose source material you may send to the configured provider. Keep originals
and an untouched starting project copy locally; run each journey on a fresh copy.
Do not use generated test clips to claim editorial quality.

For each project record a local alias, source SHA-256 hashes, source durations,
starting timeline revision and clip IDs, transcript/index readiness, and exact
starting selection. Record the immutable application commit (`git rev-parse HEAD`),
OS/hardware, reviewer, date, provider/model identifiers for chat and analysis,
consent settings, available model parameters, and warm/cold cache state. Use
`shasum -a 256 /path/to/source.mp4` to fingerprint each source locally. Keep
private paths and source content out of committed reports.

Before the first run, replace the duration placeholders below with feasible
values for each project. Record those exact prompts and freeze them for the
comparison after phases 1–3. Choose a 15-minute maximum per journey; record a
timeout or missing capability rather than changing the task until it succeeds.

## Stage B: run the same two journeys

Run both journeys once on each project (six baseline trials). Use the same
reviewer and starting state after phases 1–3. A single trial is descriptive;
report paired results without statistical significance claims.

### Journey A: edit, reopen, follow up

1. Select the recorded source clips. Start the clock on Send:
   “Create a [target seconds]-second rough cut from the selected footage.
   Preserve a complete thought or task and keep speech intelligible.”
2. Review evidence and the proposed changes through existing workflows. Apply
   explicitly. Watch and listen to the output. Record corrections and the moment
   the reviewer accepts the initial cut; do not count assistant prose as an edit.
3. Close and relaunch the app normally, reopen the same project and conversation,
   and send: “Shorten that cut to [follow-up seconds] seconds. Keep its main
   point and leave unrelated clips unchanged.” Record time separately for this
   follow-up. Note whether output IDs must be supplied again.
4. Review and accept or reject the result. Confirm the actual affected clip IDs,
   remaining duration, and whether unrelated clips changed. Undo once and verify
   the prior cut returns. Log any additional recovery steps.

### Journey B: analysis finishes after the response

1. Start from another fresh project copy and the recorded selection. Start the
   clock on Send: “Analyze the selected footage for a rough cut and prepare a
   proposal for review. Do not apply it.”
2. Observe the actual ordering of turn completion and job completion. If analysis
   finishes before the turn, record `not observed`; do not claim asynchronous
   continuation coverage. Do not cancel the app while computation is running.
3. After the job completes, close and relaunch the app and reopen the conversation.
   Record whether its result is visible and whether reopening causes any provider
   calls. Open the existing result in review. If continuation exists, use it;
   otherwise send “Continue with the completed analysis and show its proposal for
   review.” Record any extra navigation, repeated instructions, or analysis.
4. Review and explicitly Apply once. If available, try the same Apply action
   again and verify no duplicate edits; otherwise mark repeat-apply observation
   unavailable. Undo and verify the exact prior timeline returns.

While a response streams in either journey, try drafting the next message and
reading earlier chat content. Record draft loss, forced scrolling, and whether
concurrent Send is blocked. Record actual behavior, including unavailable actions.

## Measurements and evidence

| Field                       | Definition                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time to accepted cut        | Seconds from initial Send to reviewer acceptance, including review, waiting, and corrections; null if never accepted.                                                   |
| Follow-up time              | Seconds from follow-up Send to acceptance; excludes time with the app closed.                                                                                           |
| Journey elapsed             | Wall time from initial Send through undo verification; record app-closed time separately.                                                                               |
| Repeated instructions       | Extra user messages restating an already specified goal, constraint, or output reference; attach turn IDs. Exclude the scripted follow-up.                              |
| Duplicate analysis          | Extra analysis jobs for unchanged sources/scope and equivalent parameters without explicit reanalysis; attach both job IDs. Intentional retries are counted separately. |
| Acceptance                  | Accepted, rejected, failed, timed out, or not observed, with reviewer reason.                                                                                           |
| Corrections / undo          | User correction turns and undo actions counted separately; include the scripted verification undo in its own field.                                                     |
| Provider requests / latency | Actual outbound requests, including failed/cancelled attempts where observable; elapsed seconds per request, provider/model and purpose. Unknown if unobservable.       |

Use chat tool activity and its displayed durations for tool evidence, existing
job/review records for job and proposal IDs, and actual timeline state for edits.
Tool durations and turn durations are not provider request latency. One turn may
make several provider requests. Use an existing provider usage dashboard or
available request records to count requests; record their observation window and
coverage. If those records cannot isolate this trial, mark the count unknown.
Do not infer zero from missing telemetry or add logging of credentials/prompts.

Keep a local event ledger with UTC timestamps, elapsed seconds, turn/job/proposal/
output IDs, action, observed result, and evidence location. Include failed runs
and billable retries. Screenshots and recordings are optional local evidence.
Do not publish raw transcripts, media, credentials, or full tool output.

## Stage C: compare after phases 1–3

Repeat the six trials using the frozen inputs, prompts, model settings, and cache
policy. Record any unavoidable model/version or source changes as confounders;
do not merge incompatible trials. Compare each matched journey's acceptance,
times, repetition, duplicate analysis, corrections, request count and latency.
Report unknowns and failures alongside successes, separately from fixture tests.

Phase 0 is measured only when all six baseline trials have evidence and reviewer
verdicts, with unavailable metrics explicitly marked unknown. A prepared protocol
or blank workbook alone does not satisfy that gate. Later release gates require
no stale/cross-project mutation, duplicate apply, or implicit provider call on
reopen, and correct undo; baseline failures remain useful observations.
