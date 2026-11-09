# Blueprint workflow competitor research

Researched 8 November 2026 using official public documentation and product pages. These are advertised workflows, not hands-on product testing. UX lessons below are design judgments; public pages do not establish usability, output quality, or customer demand. This supplements [the broader competitive research](competitive-feature-opportunities.md).

## Cardboard: choose an outcome, then supply media

**Evidence.** The [Recipes gallery](https://www.cardboard.ai/recipes) presents named video examples with format, category, short outcome descriptions and a Remix action. The [13 October changelog](https://www.cardboard.ai/changelog) describes watching the complete example with sound, seeing required inputs, supported sizes and generative-credit requirements before remixing. It says mismatched footage triggers a question before the Director works around it. The 20 October entry describes a single media area accepting video, photos and audio, plus shareable recipe links.

**Lesson for Kerf (inference).** Let users inspect a real finished example before filling fields. Ask for footage once, then show the proposed mapping. Explain requirements and unsupported cases before creation. A recipe should promise a visible treatment, not only a list of headings.

**Limit.** The gallery and changelog do not prove how reliably AI adapts arbitrary media. Kerf should not promise this from its current deterministic clip assembler.

## Clueso: reusable editorial and visual decisions

**Evidence.** The [Clueprints library](https://www.clueso.io/clueprints) distinguishes specific results: kinetic announcements, narrated feature launches, screen-recording chapters and screenshot-based tutorials. Examples state the source material expected, and the FAQ describes editable structure and saving successful video structures for reuse. The separate [brand-kit page](https://www.clueso.io/features/clueprints) describes intros/outros, fonts, colors and layout rules, forking and creating a Clueprint from a finished project. That page says changing a Clueprint affects new projects, not finished videos. The [product FAQ](https://www.clueso.io/faqs) places custom Clueprints on Enterprise while community Clueprints are available on every plan.

**Lesson for Kerf (inference).** Make the selected outcome materially change the layout, pacing and supported inputs. Offer “Save as blueprint” after someone makes an edit they like. Define whether saved changes affect future drafts or existing clips. Preserve a clear relationship between structure and branding without requiring both to be saved under one name.

**Limit.** The public library describes broad creative behavior. Its exact editor interactions and quality were not verified; custom-template availability differs from starting with public examples.

## Descript: reusable scenes with explicit placeholders

**Evidence.** Descript's [Layout picker announcement](https://feedback.descript.com/changelog/descript-season-8) describes previewing layouts before adding them, with entry points in the scene panel, scene editor and script toolbar. Its [save-layout documentation](https://help.descript.com/templates-and-presets/layouts-save) lets a user save a scene and choose per layer: keep it, omit it, or turn it into a placeholder. Audio cannot become a placeholder. Saved-layout updates affect subsequent uses. The [official changelog](https://feedback.descript.com/changelog) describes improving replacement behavior so text does not stack when switching layouts, with notification and restoration when layers are removed.

**Lesson for Kerf (inference).** Treat footage, headings and logos as named replaceable slots. Provide contextual entry from an existing edit and show exactly what applying a template will add or replace. Scene-level reuse can be useful alongside a complete-video blueprint.

**Limit.** Scene layouts are not equivalent to whole-video story assembly. Intelligent layer matching and replacement require their own rules; a gallery UI alone does not provide them.

## Screen Studio: save appearance without rebuilding the video

**Evidence.** Its [creating-presets guide](https://screen.studio/guide/creating-preset) describes saving settings from an edited project, such as background, aspect ratio and camera position. The [applying-presets guide](https://screen.studio/guide/applying-preset) describes choosing a preset from the editor's Presets button and applying it to a project.

**Lesson for Kerf (inference).** Offer a lightweight appearance preset separately from a video-building workflow. A user who wants their normal font, colors and framing should not need to reconstruct a storyboard or append more clips.

**Limit.** These presets capture recording appearance; they do not demonstrate reusable narrative structure or arbitrary-media adaptation.

## Recommended synthesis for Kerf

1. **Browse:** three differentiated starter outcomes with playable examples, expected duration, required footage and visible treatments.
2. **Supply:** select existing footage once; expose ranges and clearly label any missing slots. Keep a deliberate title-only mode.
3. **Review:** a storyboard with thumbnails, editable title/content slots, duration and a playable preview. Offer manual source-range selection first; AI mapping can come later as reviewable suggestions.
4. **Create:** explicitly state whether the result appends to the current sequence or starts a new draft; retain atomic undo and reveal the inserted result.
5. **Reuse:** save structure as a Blueprint and appearance as a Brand kit independently. Later, save a successful timeline selection with per-element placeholder choices.

These steps are a proposed Kerf design, not a claim that any one competitor implements this exact combined workflow. Validate it using real imported recordings and measure time to a useful draft, footage corrections and draft retention after review.
