# Blueprints and brand kits

Open a project, then choose **Blueprints & brand kits** in the Footage toolbar or command palette.

Ten starter blueprints cover product demos, feature launches, tutorials, update roundups, quick tips, before/after videos, talking-head explainers, social teasers, customer stories and app walkthroughs. They provide editable structure and timing, not pre-rendered assets or AI-generated claims.

1. Choose a blueprint and the Clean, Bold or Editorial starter brand kit.
2. Customize colors, font, intro/outro and seconds per section. Edit section titles, add/remove sections, and choose ready video/image footage for each. Leave footage at **Title only** for a text section.
3. Optionally choose an imported image as a project logo.
4. Choose **Append draft**. Kerf appends ordinary media, audio and text clips after existing content, preserving the current canvas and frame rate. One Undo removes the entire application. Preview, adjust and export using the existing editor.

Video sections use footage from its beginning, limited to the selected duration or available source length. Video audio is inserted on its own track. No narration, stock media or synthetic footage is generated. The same source can be assigned to several sections, but each assignment starts at the source beginning; trim/slip the resulting clips for other ranges.

## Reuse your work

Enter a new name and choose **Save blueprint & kit**. This saves a copy of the section wording, order, timing and branding to this installation's local blueprint library. Saved copies appear in both dropdowns and survive reopening. Starter definitions stay unchanged. Project-specific footage and logo references are deliberately omitted so the blueprint can be used in other projects; choose them again there.

The library is versioned and validated in renderer local storage. Save failures are displayed, and invalid stored data is not overwritten. The library is installation-local, not part of project backups or a cloud account. Applied clips and styling are stored with the project through the normal edit path.

On an empty sequence, the kit also sets sequence styling. Existing sequences retain global styling; new blueprint title clips use the selected kit. Existing titles/captions are not restyled. Caption generation still uses its existing clean/bold/boxed presets; blueprint application does not generate captions.

## Phases

- Phase 1: validated model, ten blueprints and three starter kits.
- Phase 2: blueprint dialog and atomic timeline generation, with duration and undo tests.
- Phase 3: editable branding/structure, local reusable copies, persistence checks and desktop journey.

Current scope uses the project's existing aspect ratio, supports offline deterministic assembly, and leaves generated narration and automated footage selection to future work. These are structural starter templates; they do not include ten independently animated visual treatments.
