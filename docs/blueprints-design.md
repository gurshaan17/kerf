# Blueprint workspace design

Mode: Operate. Scope: the Blueprint workflow inside Kerf's existing Electron editor.

The user-approved direction combines visual template discovery and footage-first guided assembly. It reuses Kerf's graphite surfaces, bone text, warm accent, existing fonts, buttons, inputs and native dialog focus behavior. The task needs protected keyboard focus during preview and editing; the workspace has a wide layout and keeps its header and primary footer visible while content scrolls.

The first view presents three concrete treatments and a route to existing saved starters. A chosen treatment leads to footage, goal and budget before detailed branding. The working view puts scene order on the left, actual playback in the center and the selected scene's controls on the right. At narrower widths, scene details move beneath playback. Reordering has labeled keyboard-accessible buttons; color is not the only selection cue.

The signature interaction is reviewing a scene's selected source range in the full draft without changing the project. The preview uses a separate store with no hydration or project event subscription and the same compositor and audio playback as the editor. The generated command is also the command applied to the timeline. Examples are labeled illustrative and never become draft inputs.

Controls expose import, missing media, invalid range, disabled commit, processing, error recovery, template-switch confirmation, separate saves and atomic undo. Busy application disables editing and closing. Draft setup remains available after an apply failure. No service or AI consent is required because this workflow performs no remote analysis.

Verification: engine/planning tests compare the generated preview with actual command application; the desktop journey checks source ranges, rendered source color, saving/reopening, narrow layout, insertion and undo. Captures live in `.cache/blueprints-*.png`. The source design detector reported no findings for the Blueprint components. These checks establish implementation behavior, not usability-study results.
