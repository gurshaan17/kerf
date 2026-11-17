# Semantic highlights

Phase 6 discovers several candidate highlights from **one ready, speech-bearing
source video** with a reviewed transcript. Each approved candidate becomes a
separate editable project. The source project and its timeline stay intact.

## Discover, review and create

1. Import the video and transcribe/review its speech using the existing local
   transcription controls. Discovery reuses this transcript; it never starts a
   second transcription or a provider request merely because a panel opens.
2. Open **Assistant → Discover highlights**. Choose the source and an enabled
   provider with Chat consent. Discovery sends transcript evidence and your
   requested topic to that provider; no frames, original audio or video are sent.
3. Choose a count (1–6), minimum/maximum duration (1–180 seconds) and optional
   topic/audience. Defaults are three candidates of 20–60 seconds. Click **Find
   candidate moments**. This starts one persisted job and one bounded model call.
4. Review candidate titles, rationales, openings, exact excerpts, source frame
   ranges, durations and warnings. Fewer candidates, including none, are valid.
   Expand **Transcript evidence** to inspect the underlying source evidence.
5. Check only the candidates you want. Adjust start/end evidence boundaries if
   needed, and preview the actual source interval. The server revalidates duration
   and overlap after adjustments. Invalid selections create nothing.
6. Click **Create selected projects** to approve creation. Unchecked candidates
   create no output. Open an output explicitly using its **Open** button to refine
   it through normal editing, captions, audio finishing and manual export.

Source aspect and native frame rate are preserved. No vertical crop, speaker
tracking, captions, audio finishing or export is added during creation. Those
remain explicit follow-up work. This is the narrow highlight-discovery release,
not the entire demo-gallery/Blueprint expansion in the clipping plan.

## Output identity and isolation

Kerf has one sequence per project. Highlights therefore use ordinary child
projects rather than introducing multi-sequence architecture. Each gets its own
project, asset, video and synchronized audio clip IDs. Source files are linked,
not copied. Parent-generated proxy/cache paths are not shared: deleting a source
project cannot remove an output's referenced proxy. Keep the original media file
available, as with any imported asset.

Project creation and the approval ledger publish together in a SQLite transaction.
A failure rolls back every child row and removes newly staged folders. A process
crash may leave an unused folder, but cannot publish a partial project list.
Repeated approval cannot recreate outputs, including after app restart or explicit
output deletion. Rejected candidates never mutate a timeline.

Creating a project is separate from timeline Undo. Remove an unwanted output
through the normal project browser. Edits inside an open output use ordinary
commands and Undo and cannot change siblings. The source timeline and its Undo
history are preserved throughout discovery and creation.

Each child project persists versioned `highlightOrigin` provenance with parent,
source fingerprint, job/candidate and output clip IDs. Chat persists approved
output identities to the originating conversation immediately, including an
inactive conversation, without another model call. Use `readClipOutputs` to
resolve current project existence. Saved IDs are navigation facts; open the exact
output and reread its timeline before editing. Deleted outputs are reported as
deleted and never recreated automatically.

## Shared tools

| Tool                      | Result                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `startClipDiscovery`      | Asynchronous discovery job for one explicit source/provider and bounded request               |
| `readClipDiscovery`       | Stored evidence, candidates, warnings and current review eligibility                          |
| `createClipsFromProposal` | Requests desktop review of candidate IDs and optional evidence boundaries; creates no project |
| `readClipOutputs`         | Durable approved project/clip IDs and current project existence, from the source project      |
| `verifyClipOutput`        | Structural/source verification from the source or that output project                         |
| `cancelClipDiscovery`     | Cancels pending discovery/review; preserves already-created projects                          |

Only the desktop confirmation operation creates projects. Chat and MCP share the
same tool implementations and cannot bypass approval. A turn with selected-source
scope must explicitly include the whole source asset; a trimmed timeline clip
alone does not authorize discovery across the full file.

`verifyClipOutput` checks source identity, original video/audio clip presence,
normal speed, approved range and output duration. Refinements can legitimately
make these checks differ from the original approval. A structural pass does not
prove a useful opening, visual framing, intelligibility or editorial quality.

## Bounds and lifecycle

Evidence consists of sentence/pause groups reconstructed from reviewed word
intervals, with existing segment ranges used when words are unavailable. Every
unit retains originating segment IDs. Candidates use contiguous supplied units;
models cannot introduce timestamps, editing commands, overlapping ranges or
ranges outside requested duration limits. Requests exceeding 400 units or 60,000
serialized evidence characters fail explicitly. Shorten the source for this first
release rather than silently omitting evidence.

Discovery makes one text call with no automatic retries, a 4,096-token output
budget and a two-minute timeout. Provider configuration and consent are checked
before and after the request. Source metadata, filesystem identity and transcript
revision are revalidated before review and creation. Source/index changes require
fresh explicit discovery. Project switching, cancellation and stopping the active
initiating chat turn cancel pending work. App restart marks queued/running
highlight discovery interrupted; it never resumes billable work automatically.
Completed proposals and output identities remain readable without provider calls.

## Verification and human review

Automated coverage checks exact source evidence, fewer/empty results, invented
boundaries, overlap/duration rejection, source/project scope, consent, cancellation,
interrupted jobs, atomic rollback, independent edits, exact Undo and duplicate
creation rejection. A deterministic Electron provider journey auditions real
source video/audio, creates only selected projects, opens/refines an output, and
reopens the app without extra calls or duplicated outputs.

Human editorial evaluation is separate and remains pending. On a representative
long interview, record provider/model and source/transcript revision, then review:

| Check                  | Record per candidate                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| Complete thought       | Can a viewer understand it without the preceding conversation?                    |
| Useful opening         | Does the opening establish a specific subject or benefit?                         |
| Complete ending        | Does it finish the point without cutting off necessary context?                   |
| Diversity              | Does it add something distinct from the other selected clips?                     |
| Boundaries and framing | Do sentence starts/ends, pauses and original framing work in playback?            |
| Corrections            | Boundary adjustments, rejected candidates, follow-up edits and time to acceptance |

Fixture passes prove workflow correctness, not better editorial judgment.
Embeddings/vector retrieval, speaker tracking, automatic exports and the broader
Blueprint demo gallery remain deferred.
