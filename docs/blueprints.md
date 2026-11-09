# Blueprints and brand kits

Blueprints combine a visual starting point with a footage-backed storyboard. The draft stays separate from your timeline until you add it.

## Start a video

Choose **Start with a Blueprint** on an empty timeline, **Blueprints** in the Footage toolbar, or **Blueprints & brand kits** in the command palette. The Footage action carries your selected asset into setup when you start a new storyboard.

1. **Choose a starting point.** Product demo, Quick tip and Step-by-step tutorial have visual cards and playable treatment previews. The previews use clearly labeled illustrative panels and sample text, not footage that will enter your draft. Other original starters and saved Blueprints remain available in the dropdown.
2. **Choose footage.** Select an imported recording/image or import one. Optionally describe the video's goal and choose a footage budget and brand preset. For a recording, Kerf assigns consecutive ranges up to the available duration. This is deterministic division, not AI scene understanding. Opening/closing cards are additional to the footage budget.
3. **Review the storyboard.** Select a scene, change its source, trim by seconds or scrub the source and choose **Start here** / **End here**. Change its purpose independently of its on-screen title. Enable a title explicitly, or choose **Title card** as the scene's content type. Reorder with the earlier/later buttons, duplicate, remove or add scenes. Two to twelve scenes are supported.
4. **Preview the actual draft.** Playback and the scrubber use the editor's renderer, generated clips, audio, source ranges and styling in an isolated preview. No edits or undo entries are created by previewing. Missing required media, invalid titles/purposes and invalid source ranges block insertion with an explanation.
5. **Add to timeline.** On a populated timeline the button says **Add after current edit**, and the preview summary shows the insertion time. Existing edits remain intact. Applying is a single reversible batch; repeat clicks cannot add the same draft twice while it is being applied. Kerf selects the first inserted clip and moves the playhead to the draft.

The goal provides opening-title wording when supplied; it does not trigger content analysis. The three starters use different story lengths and title treatments: lower centered demo titles, larger upper quick-tip titles, and smaller numbered tutorial labels. Quick tip starts without a forced opening/closing card. Title styling can be adjusted with the brand controls. These are restrained editing treatments, not generated animation packages.

## Keep control of your work

Going back from the storyboard preserves scene edits. Changing the starting footage or budget rebuilds source ranges; the setup explains this. Switching to another Blueprint after preparing a storyboard asks whether to replace it. Closing and reopening the workspace retains unfinished work in the current project session. Unapplied storyboards are not persisted across an app restart.

Video source ranges are validated against the recording length. Reusing one recording does not repeat its opening: each scene can use a different range. Timing is quantized to the project's frame rate. Video audio is inserted on its own track; image and title-only drafts do not create empty audio/video tracks. A title card must be chosen deliberately instead of being a fallback for missing footage.

## Branding and reuse

Expand **Brand & opening / closing cards** to choose a preset, customize colors/font, add optional opening/closing cards or select an imported image as a logo. Save branding independently using **Save brand preset**.

Expand **Save Blueprint structure** to save scene purposes, wording, content types, title visibility, timing proportions and treatment. Footage references and source offsets are omitted so another project can supply its own media. Reusing the saved structure divides the selected footage according to its scene timing proportions. Existing saved Blueprints without these additional fields still open using their original section structure.

The library is validated and stored locally in this installation. Saved Blueprints and presets survive reopening and are available across projects. Save failures are shown; corrupt library data is not overwritten. This library is not included in project backups. Applied timeline clips are saved normally with the project.

On an empty timeline, the selected kit also sets sequence styling. Existing edits keep their global style; new title clips use the chosen kit. No stock media, synthetic footage, narration, captions or screen-polish effects are silently generated. Existing analysis, narration and screen-polish workflows remain separate.

See the [UX proposal](blueprints-ux-proposal.md) and [competitor research](blueprints-competitor-research.md) for rationale and possible later work. Saving a finished timeline selection as a Blueprint and AI scene matching are not implemented in this version.
