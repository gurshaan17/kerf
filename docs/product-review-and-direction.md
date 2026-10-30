# Kerf product review and direction

**Reviewed:** 30 October 2026  
**Basis:** repository and product documentation review; competitor claims checked against official product pages/changelogs. This is a code and docs review, not a hands-on usability session or a fresh run of the test suite.

## Executive view

Kerf already has a credible foundation for a local-first, agent-editable video editor. It combines a non-destructive timeline, compositing, local analysis, text/caption tools, beat and reference analysis, export, and one typed command surface shared by the UI, assistant, and MCP. That is a coherent product thesis, not a feature demo.

The main risk is breadth without a clearly completed user journey. The codebase supports many capabilities, but there is no installer/release path yet, platform support is only exercised on macOS, and product documentation itself labels the app as actively developing. The best next work is to make a small number of end-to-end workflows dependable and easy to understand, then ship those reliably.

**Recommended direction:** build Kerf as the private, local-first editor for turning a user's existing footage into polished, editable explainers and social/product videos. Make the timeline and reversible agent actions the core; keep provider use optional and explicit. Prioritize transcript-led editing, project reliability, and review/export workflows before adding broad generative-media features.

## What Kerf has today

The README and implementation describe these product areas:

- Project browser and SQLite-backed project, asset, job, and edit history.
- Media ingest with probing, proxies, thumbnails, waveforms, duplicate detection, and relinking.
- Multi-track editing with move/trim/split/ripple, snapping, markers, undo/redo, and speed mapping.
- Canvas preview/export for transforms, effects, masks, blend modes, keyframes, text, captions, motion compositions, and timed blur/callout/spotlight/zoom overlays.
- Local transcription, scene and beat detection, transcript/scene search, optional vision descriptions, and reference profiling.
- Shared typed tools for the built-in assistant and MCP, with edits attributed and undoable.
- MP4 export and OpenTimelineIO timeline export.

These are meaningful differentiators, especially the local project model, provider opt-in, common typed edit path, and reversible agent changes. The repo also has targeted unit coverage and a set of Electron journey tests, including overlays and an edit-to-export path. Test presence is evidence of intended coverage, not proof that every feature works in a packaged build or across real user media.

## Competitive read

| Product                                       | What it emphasizes                                                                                                                                                                                                                                                                                                                                                       | Implication for Kerf                                                                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Cardboard](https://www.cardboard.ai/)        | Prompt-to-first-cut, chat refinement against an editable timeline, footage search, generated assets, review/sharing, and NLE handoff. Its [changelog](https://www.cardboard.ai/changelog) highlights agent edits and visual validation; its [MCP docs](https://docs.cardboard.ai/mcp) expose agent workflows.                                                            | Kerf already has many foundational pieces (agent editing, analysis/search, MCP, timeline). The gap is how quickly a new user can reach a good first cut and how confidently the agent can check its visual result.                                             |
| [Clueso](https://www.clueso.io/)              | Product education and walkthroughs: screen/workflow capture, script cleanup, voiceover, captions, zoom/callout/blur/spotlight, branded templates, localization, and paired guides. See [video features](https://www.clueso.io/features/video-features), [Clueso Agents](https://www.clueso.io/features/clueso-agents), and [changelog](https://www.clueso.io/changelog). | Kerf's editing and overlay primitives fit tutorial/explainer videos, but it lacks a purpose-built capture-to-published-guide workflow, reusable brand presets, and localization. These are potential vertical workflows, not reasons to copy Clueso wholesale. |
| [Descript](https://www.descript.com/features) | Transcript-centric editing, recording, filler/retake cleanup, audio repair, captions, and repurposing.                                                                                                                                                                                                                                                                   | Transcript-led cutting and audio cleanup are expected workflow accelerators for spoken content. Kerf has transcript data and silence/caption macros; make those directly discoverable and safe to refine.                                                      |

Competitor capabilities and packaging change frequently; the links above are the primary sources to recheck before committing to roadmap or pricing decisions. The prioritization below is my inference from those sources and the repository, not a claim that one competitor feature is universally required.

## Gaps and risks to resolve

### P0: Release and reliability

1. **No supported installer/release path.** README says packaging/signing are deferred and no installer is supported. A desktop editor needs a reliable install, update, and recovery story before broad user testing.
2. **Platform boundary is unclear.** Requirements say macOS is the tested path while the code is intended for other desktop platforms. State the supported platform plainly and validate Windows/Linux before making support claims.
3. **Media lifecycle is high stakes.** Kerf references source files in place and generates proxies/caches. Validate missing-source relink, interrupted ingest/export, disk-full behavior, cache cleanup, and project backup/restore with real projects. These are hypotheses to verify; this review did not execute those flows.
4. **Large-project behavior needs evidence.** Existing performance targets describe a short 640×360 fixture on one M2 machine. Add representative 4K/long timeline/many asset scenarios before treating those numbers as user-facing performance expectations.

### P1: Workflow coherence

1. **First-cut path is not prominent in the product story.** `assembleRoughCut`, `cutSilences`, captions, and beat tools exist, but onboarding should guide a user from import → select source → rough cut → captions → polish → export.
2. **Agent visual verification is thin as a workflow.** A `renderFrame` tool and image result exist; build a bounded inspect/revise loop with explicit preview points, user-visible changes, and easy undo. Never let a model silently export or overwrite.
3. **Transcript editing is split across tools/panels.** Promote transcript-range selection, remove speech/pause, and caption generation into a joined interaction. Make cuts inspectable and recoverable on the timeline.
4. **No review/share handoff.** Exports exist, but there is no documented review/comment delivery workflow. For a local-first product, start with export bundles and a lightweight review artifact rather than a hosted collaboration backend.
5. **Brand and format repetition are manual.** Add saved brand kits (fonts, colors, logo, caption style) and safe sequence/reframe presets for recurring video work.

### P2: Focused differentiation

- Consider an opt-in screen/workflow recorder plus tutorial-specific authoring flow: narration, cursor emphasis, zoom/callout presets, and a paired step guide. This fits Clueso's audience while using Kerf's existing overlays and local storage.
- Improve semantic footage search and selection using the transcript/scene index already present. Keep local analysis first and make any remote vision/provider calls explicit.
- Consider translations/localized captions and voiceover only after the core caption/export workflow is dependable; these increase provider, licensing, and QA complexity.

## Feature status: what works vs what still needs proof

The repository has unit and end-to-end tests for key paths: project startup, keyboard panel navigation, importing/cutting/captions/export, transcript and scene panels, beats, and overlay addition/linking/export-frame comparison. There are extensive engine/model tests for inverses and timeline logic. This is a strong base.

This review did **not** run tests or launch Kerf, so I cannot certify that a feature is currently working in the app. The most important proof gaps from the inspected docs are:

- E2E coverage is a small set of scripted journeys; it does not establish robustness on varied codecs, unusual frame rates, long media, multiple displays, or packaged production builds.
- The README calls the project actively developing and notes that packaging/signing are deferred. This is a concrete release gap, not a suspected code defect.
- Performance evidence is one machine and a tiny fixture; it does not establish scaling behavior.
- The code/docs indicate source media is not copied into the project. Recovery, portability, backups, and moving a project between machines deserve explicit UX and acceptance criteria.
- Avoid interpreting absent TODO matches as evidence of completeness. A source inspection cannot prove playback quality, export correctness across codecs, or that controls are discoverable.

## Recommended roadmap

### Now: prove the core loop

1. Pick the first target user and one job: e.g. an independent creator or product educator making a 1–5 minute tutorial from existing footage.
2. Run moderated sessions on a clean install and real user media. Record where import, relink, rough cut, transcript edit, captions, and export fail or confuse.
3. Harden project safety: backup/restore, relink and cache recovery, cancellable jobs, and clear failed-export recovery.
4. Make the guided first-cut workflow visible; use existing macros and timeline commands before inventing new editing primitives.
5. Define a release candidate bar and produce signed/notarized macOS builds (then validate another platform only if support is part of the plan).

### Next: increase output quality per minute

1. Add transcript-driven selection and cut controls, with preview and one-step undo.
2. Add agent visual-check steps around a user-approved rough cut: render representative frames, inspect, suggest/apply a small batch, and show a change summary.
3. Add brand kits and reusable export/reframe presets.
4. Improve tutorial/explainer overlays with reusable layouts and keyboard-friendly controls.
5. Make media search return clickable timeline/source ranges and use scene/transcript evidence to ground rough-cut choices.

### Later: expand only where users pull

- Screen recording and paired SOP/guide generation.
- Localization, translated captions, and voiceover.
- Review links/comments or a local review package, depending on whether users need collaboration or just handoff.
- Optional generated B-roll/voice/music, with clear provenance and explicit provider/network controls.

## Decision and success measures

For the next product cycle, avoid competing on the number of AI features. Measure whether a new user can finish a real tutorial/explainer reliably and whether the agent saves time without reducing edit control.

Suggested measures:

- Time from first launch to first successful export.
- Share of new users who complete import → rough cut → captions → export without help.
- Export failure and project-recovery rates across representative media.
- Minutes of manual transcript cleanup/cutting per finished minute.
- Agent edits accepted, undone, and corrected after preview.
- Median seek/preview/export performance on agreed reference projects.

Revisit the direction after user sessions. If users value general editing more than tutorial production, keep the local-first, agent-editable editor thesis and defer the screen-recording vertical.
