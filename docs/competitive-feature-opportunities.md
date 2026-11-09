# Competitive feature opportunities for Kerf

Researched 4 November 2026. Based on official product pages and Kerf source/docs, not hands-on competitor testing. Product pages describe advertised capabilities; quality, availability, and plan restrictions need separate validation. Priorities and effort are judgments, not measured demand or delivery estimates.

## Blueprint follow-up

The initial Blueprint implementation was reviewed on 8 November 2026. See the [UX proposal](blueprints-ux-proposal.md) and [focused competitor research](blueprints-competitor-research.md) for a proposed move from configuration forms to visual examples, footage-backed storyboards and preview before applying. These are recommendations, not shipped capabilities.

## Recommendation

Build a local-first workflow for turning existing recordings into polished, editable product videos. Start with reusable recipes, transcript-driven edits, and screen-recording polish. Kerf already has much of the underlying editing machinery; the opportunity is to reduce the decisions and manual steps required to finish a video.

Two plausible audiences lead to different priorities: product educators benefit most from recipes, zooms and paired guides; interview/podcast creators benefit most from transcript editing, audio cleanup and highlight extraction. The default recommendation here assumes product demos and explainers, while retaining transcript editing as a broadly useful investment.

## Existing capabilities to extend

- [README](../README.md): local projects, ingest, timeline, transcription, search, reference profiling, chat/MCP, export and OTIO.
- [Tool catalog](tools.md): `assembleRoughCut`, `cutSilences`, `duckUnderSpeech`, captions, batch edits, motion compositions and overlays.
- [Visual narration](visual-narration.md) and [TTS](text-to-speech.md): silent-footage narration drafts, review, generated speech, duration checks and linked timeline placement already exist. Basic voiceover is not a new feature proposal.
- [Transcript panel](../src/renderer/transcript/TranscriptPanel.tsx): speech transcripts support search, copy and seek; they are not yet a document-style media editing surface.
- [Transcription parser](../src/main/analysis/transcribe.ts): `splitEntry` estimates word boundaries when an input entry contains several words. Do not assume every stored word timestamp is acoustically aligned.
- [Overlay model](../packages/model/src/overlays.ts): blur, callout, spotlight and zoom already exist. Automated selection, tracking and reusable styling are the proposed additions.

This updates the opportunities discussed in [the earlier product review](product-review-and-direction.md), particularly its treatment of narration and voiceover. Source inspection is not a fresh runtime verification.

## What to borrow

| Priority | Feature and inspiration                                 | Concrete Kerf version                                                                                                                                                                  | Relative effort and dependency                                                                                                                                                        |
| -------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Reusable recipes — Cardboard Recipes, Clueso Clueprints | Choose Product demo, Feature launch or Narrated tutorial; supply footage, goal and duration; get an editable draft with saved fonts, colors, caption style, intro/outro and structure. | Medium. Reuse macros, text, motion and batch commands; add recipe/brand persistence and missing-input handling.                                                                       |
| 2        | Transcript editing — Descript                           | Select a sentence to remove its media, extract it or move it; show proposed cuts and permit one-step undo. Begin at sentence/segment granularity.                                      | Medium–large. Correct source-to-timeline mapping and timing validation are prerequisites for precise word cuts.                                                                       |
| 3        | Automatic screen polish — Screen Studio, Clueso         | Propose zooms, spotlights and callouts around important interactions; show focus points and let users adjust them.                                                                     | Medium for manual focus points and presets; large for capture metadata and robust automatic detection. Existing zoom lenses do not automatically provide whole-frame camera movement. |
| 4        | Video plus illustrated guide — Clueso                   | Generate editable numbered steps with source timestamps and screenshots; export Markdown/HTML plus images next to the video.                                                           | Medium–large. Reuse narration/scene evidence; add step selection and screenshot export. Images alone do not prove what action occurred.                                               |
| 5        | Reviewable privacy redaction — Clueso Auto-blur         | Detect candidate emails, identifiers and other sensitive text locally; propose editable timed blur regions and review their coverage.                                                  | Large. OCR, region tracking and export-frame checks are new work; a fixed blur cannot reliably follow scrolling content.                                                              |
| 6        | Highlight extraction — Cardboard, OpusClip              | Ask for several self-contained clips within a duration range; show source evidence, opening/ending text and why each was selected; create separate editable outputs.                   | Medium–large. Extend transcript/search/rough-cut infrastructure; add candidate review and multiple-output management.                                                                 |
| 7        | Smart reframe — Cardboard, OpusClip                     | Make vertical/square variants with editable subject focus paths, caption safe areas and preview.                                                                                       | Large for subject tracking. A vertical export preset changes dimensions but does not track the speaker or UI.                                                                         |
| 8        | Speech cleanup — Descript                               | Add local loudness matching, noise reduction, limiter and A/B preview; expose existing speech ducking clearly.                                                                         | Medium for conventional filters; large for model-based voice restoration. Ensure preview and export use equivalent processing.                                                        |
| 9        | Localized versions — Clueso                             | Translate reviewed narration/captions into a duplicate language version, retain terminology overrides, regenerate voice and flag overflow.                                             | Large. Existing TTS helps, but translation quality, version linkage and duration synchronization remain new work.                                                                     |

## Primary-source evidence

### Cardboard

Its [homepage](https://www.cardboard.ai/) advertises prompt-and-footage first cuts, chat/timeline refinement, cleanup, moment selection, reframing, media generation and review links. Its [Recipes library](https://www.cardboard.ai/recipes) offers examples to remix with supplied media. The [13 October 2026 changelog entry](https://www.cardboard.ai/changelog) describes remixable finished edits.

**Lesson:** give users an outcome to start from. Kerf's chat, MCP, reference analysis and motion tools already overlap with its foundations. Recipes and reliable first-draft orchestration add more than another generic chat feature.

### Clueso

[Clueprints](https://www.clueso.io/clueprints) save story structure, appearance, motion and sound; its [brand-kit page](https://www.clueso.io/features/clueprints) describes reusable intros, outros, fonts, colors and layouts. Its [FAQ](https://www.clueso.io/faqs) describes paired step-by-step articles with screenshots and Markdown/HTML export, synchronized voiceovers and localization. [Auto-blur](https://www.clueso.io/features/auto-blur) advertises sensitive-text detection and editable blur elements.

**Lesson:** package existing primitives into a repeatable product-education workflow. An editable local guide accompanying a video is a useful differentiated deliverable.

Its [Agents page](https://www.clueso.io/agents) also advertises browser-driven recording and GitHub-connected video updates. Defer autonomous product navigation and release-triggered regeneration: they introduce substantial capture, authentication and maintenance scope beyond finishing imported footage.

### Screen Studio

Its official guides describe [click-targeted auto zoom](https://preview.screen.studio/guide/auto-zoom), [cursor appearance and cleanup](https://preview.screen.studio/guide/cursor), [typing acceleration](https://preview.screen.studio/guide/speed-up-typing-segments) and [reusable presets](https://preview.screen.studio/guide/creating-preset).

**Lesson:** polish can be a repeatable pass. For Kerf, begin with editable focus regions over imported footage. Reliable click-aware zoom and independent cursor styling would require capture metadata or a separate cursor recording; flattened imports do not provide those automatically.

### Descript

The [official feature catalog](https://www.descript.com/features) describes transcript-linked deletion and sentence movement, filler/retake removal, and noise/echo cleanup through Studio Sound.

**Lesson:** make the transcript an editing surface. Keep correcting transcription text separate from deleting media, and offer reviewable cleanup proposals. Conventional audio filters should not be represented as equivalent to its model-based enhancement.

### OpusClip

[ClipAnything](https://www.opus.pro/clipanything) advertises prompt-selected moments using visual/audio signals and subject/object tracking for reframing.

**Lesson:** add a candidate-based highlights workflow before broad multimodal clipping. Kerf's auto cut removes weak material; selecting complete standalone excerpts from a long recording is a different job. Each proposed highlight should preserve source context and remain editable.

## First three deliverables

1. **Recipes with saved branding.** Ship three focused recipes with required inputs and editable output. Applying one must be a single reversible action, and missing assets must be reported rather than invented. First version can reuse user-supplied media without stock search or generation.
2. **Transcript cuts.** Sentence selection, cut preview, delete/extract and undo. Cover repeated timeline occurrences, linked audio/captions and differing frame rates. Keep precise word editing behind demonstrated alignment quality.
3. **Screen polish presets.** Start with user-selected focus points, reusable callout/spotlight styles and smooth timing. Add automated suggestions after this interaction is useful. Capture click/cursor metadata later if recording becomes a validated need.

For an interview-focused audience, substitute audio cleanup for screen polish and move highlights ahead of paired guides.

## Defer

- Broad image/video/music generation and avatar features: large provider/cost surface with limited advantage from Kerf's local editing architecture.
- Hosted comments/workspaces: start with portable local output/review artifacts if handoff is needed.
- Voice cloning: existing configurable narration voiceover covers a useful initial need.
- Another MCP integration or basic overlay implementation: those foundations already exist.

Measure time from import to an acceptable export, draft edits retained after review, manual cleanup time, and recipe reuse. Validate with real recordings; this research does not establish competitor feature quality or customer willingness to pay.
