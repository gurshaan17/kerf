# Blueprints UX proposal

Reviewed 8 November 2026. Proposal only; no application behavior changed.

## Recommendation

Make Blueprints a visual starting point for an editable video. Replace the long configuration dialog with a gallery followed by a footage-backed storyboard and real playback before committing the draft. Assume the first audience is people making product demos and tutorials from existing recordings; this is a working assumption, not validated demand.

The original [competitive research](competitive-feature-opportunities.md) proposed supplying footage, a goal and duration to get a draft. The implementation delivers reusable section text and branding but leaves much of that editorial work to the user. See the [focused competitor research](blueprints-competitor-research.md) for current primary sources and their limitations.

## What is wrong with the current flow

Source review: [dialog](../src/renderer/recipes/RecipesDialog.tsx), [definitions](../packages/model/src/recipes.ts), [compiler](../packages/engine/src/recipes.ts). The cached desktop journey screenshot `.cache/recipes-dialog.png` was also inspected; this review did not test authenticated competitor products.

- Discovery depends on a clapperboard icon in the Footage toolbar. People must already know to look for Blueprints.
- Branding controls occupy the first screen before footage selection. A user must configure the video before understanding its result.
- Ten starter definitions share the same title/media assembly path. Different section wording and timing do not establish ten distinctive visual treatments.
- The preview is a styled text sample, not playback of the planned video, source ranges, motion or audio.
- Every section starts as Title only. A successful action can produce a result far from a user's expectation of a polished video.
- Every assigned video begins at source frame zero. Reusing a long recording across sections repeats its opening instead of telling a coherent story.
- Uniform seconds per section ignores the time required to explain an interaction.
- Save blueprint & kit combines two reusable objects. A new story structure should not require another copy of the brand kit.
- Append draft exposes placement before providing a review of what will be inserted. Existing content is preserved and undo is atomic; retain those guarantees.

These findings come from the implementation and one local screenshot, not a usability study.

## Three possible directions

| Direction                     | Primary interaction                                                  | Best use                                       | Limitation                                                         |
| ----------------------------- | -------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| Visual template gallery       | Watch a sample, supply footage, review a storyboard                  | New users who need a convincing starting point | Requires real, distinct templates and representative examples      |
| Footage-first guided edit     | Select a recording, goal and target duration; review proposed scenes | Product demos and tutorials                    | Automatic scene matching needs evidence and editable source ranges |
| Save this edit as a Blueprint | Mark replaceable content in a finished edit and reuse its treatment  | Repeat creators and team consistency           | More complex rules for portability, replacement and timing         |

Combine the first two in the initial redesign. Add the third after the generated results are worth reusing. Keep manual editing available; chat can refine a draft without becoming the only way to control it.

## Proposed journey

### 1. Enter from the task

Show a labeled Blueprints action on an empty timeline and allow selected footage to open Make a video with a Blueprint. Retain command-palette access. On a populated timeline, make it clear that the action creates an additional draft.

Start with three useful examples: Product demo, Quick tip and Step-by-step tutorial. Each card has a playable sample, duration range, aspect ratio, needed inputs and a concrete description of the result. Samples must use actual supported layouts and effects. Example media must not silently enter the user's output.

### 2. Supply footage and intent

Select existing project footage or import it. Carry any prior footage selection forward. Ask for one short goal, target duration and an existing brand preset. Keep detailed colors, fonts, intro/outro and logo behind Edit brand. Persist the chosen brand separately.

For example: recording `workspace-demo.mp4`; goal “Show how to create and share a workspace”; target “About 45 seconds.” This is an illustrative input, not a promise of automatic understanding in the first release.

Without analysis, let the user select meaningful ranges from the recording. With opt-in analysis later, propose ranges and explain their source evidence. A target duration must not silently crop an unfinished action or imply precise timing before the footage is reviewed.

### 3. Review an editable storyboard

Use a spacious workspace instead of a tall modal. Put ordered scene cards on the left, actual playback in the center and details for the selected scene on the right. Adapt the layout at smaller widths and support keyboard reorder alongside drag and drop.

Each scene shows its role, thumbnail, source time range, output duration, on-screen title and status. Offer Change footage, Trim, Reorder, Duplicate and Remove. A role such as “Show the result” is editing guidance; it should not become visible title text automatically.

Make the scene type explicit: Footage, Title card or Outro. Missing footage should show Choose footage, not silently fall back to a title card. Let users deliberately convert a scene to a title card or omit an optional scene. Display readiness such as “3 of 4 scenes ready.”

Preview the same planned clips, timing and styling that will be committed. A static image should be labeled as a style sample until actual playback is available. Previewing must not modify the main timeline or add undo entries.

### 4. Commit an understood result

For an empty timeline, use Add to timeline. For existing edits, use Add after current edit and show the insertion time. Show a short summary: estimated total duration, scene count, selected brand and any omitted optional scenes. Disable commit for unresolved required media or invalid ranges and explain the reason beside the affected scene.

Apply as one reversible edit, select the inserted content and bring it into view. Keep draft state on recoverable failure. Reopening setup should preserve work; changing a template should offer to retain compatible footage assignments rather than silently discard them. Repeated clicks must not duplicate the draft.

### 5. Reuse once the result works

Keep Brand presets in their own editor. Initially save named story structure separately from branding. Later, add Save as Blueprint from a finished edit: choose replaceable media slots, retain deliberate layout/motion/timing rules, and show a portability report for missing fonts/assets. Changes to a saved template should not silently rewrite already edited videos.

## Make the templates meaningfully different

- Product demo: brief opening, footage-led explanation, restrained callouts, clear ending.
- Quick tip: short problem, one complete interaction, result; avoid forcing an intro/outro.
- Tutorial: readable step labels and chapters; preserve enough footage to finish each action.

Specific motion, captions, narration and screen polish should be visible capabilities of the chosen template. Add them only where supported and reviewable. The current compiler cannot produce all these treatments merely by rearranging fields.

## Delivery order and stop condition

1. First redesign: three honest example cards; footage/range selection before branding; storyboard scene cards; explicit missing-input states; actual preview; clear atomic commit. Reuse the existing editing commands and undo behavior. Range selection and preview planning require implementation beyond the current dialog.
2. Then add assisted scene suggestions using existing transcript/scene evidence, followed by optional screen-polish proposals. Explain remote processing and required consent before any footage leaves the device; the manual path remains usable offline.
3. Add reuse from finished edits after the three starter workflows produce outputs users want to repeat. Defer a marketplace, community sharing and arbitrary reference-video recreation.

The first redesign is complete when a person can pick one recording, choose different source ranges for scenes, preview the exact draft without changing their edit, resolve missing footage and add the result in one undoable action. Measure whether people can predict the result, how much they replace after applying it, and time to an acceptable export. Targets require a baseline; do not invent conversion or time-saving claims.
