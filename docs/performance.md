# Performance

Kerf is a local-first editor, so the important budgets are the ones a person
feels while working on their own machine: time to a usable window, time to an
ingested clip, preview responsiveness, and export throughput. These are
measured goals, not CI gates. Hardware, codec, and project size all change the
numbers.

## Targets

| Area          | Target                                                   | Result on the reference machine |
| ------------- | -------------------------------------------------------- | ------------------------------- |
| Startup       | Main window ready in under 2 seconds                     | 0.5–0.9 s                       |
| Ingest        | Import a short clip and reach `Ready` in under 2 seconds | 0.9 s                           |
| Preview seek  | A timeline click updates the preview in under 50 ms      | 16 ms                           |
| Export render | 1080p at 24 fps or better                                | 47–51 fps                       |

The reference machine is an Apple M2 with 8 GB of memory running macOS 27.0.1.
The fixture is a 4.4 second 640 × 360 H.264 clip with AAC audio. The export is a
2 second, 1920 × 1080 sequence at 24 fps (48 frames) encoded from PNG frames.

## How to measure

```sh
pnpm perf
```

`pnpm perf` builds the Electron bundles, launches the real app through
Playwright, and runs the end-to-end edit journey with `KERF_PERF=1`. It prints:

```text
[perf] startup 1370ms
[perf] main window ready 645ms
[perf] ingest 867ms
[perf] seek 16ms
[perf] export render 969ms (48 frames, 49.5fps), total 1414ms
```

The measurement points are deliberately end to end:

- **Startup** is wall-clock time from Playwright's launch call to the project
  browser. The narrower `main window ready` value is measured inside the main
  process from module evaluation to Electron's `ready-to-show`.
- **Ingest** runs from the import call until the asset card reports `Ready`,
  which includes the proxy and thumbnail jobs.
- **Seek** runs from a timeline click until the preview canvas reports the new
  frame.
- **Export render** runs from the export click until the renderer has written
  the last frame and the main process starts encoding. It includes compositing,
  PNG encoding, IPC, and disk writes.

`pnpm perf` needs `ffmpeg`, `ffprobe`, `whisper-cli`, and the macOS `say`
command. The tiny Whisper model is downloaded once into `.cache/e2e/` and is
ignored by git. The normal `pnpm test:e2e` run does not print perf lines and
does not assert on hardware-specific numbers.

## What changed

- Background job and MCP startup is deferred until after the first window is
  created, so the project browser paints sooner.
- Timeline and inspector subscriptions select only the sequence, assets, and
  history they use. Job progress no longer re-renders the whole timeline.
- Analysis summaries memoize on the underlying analysis arrays rather than the
  whole snapshot object.
- Thumbnails load lazily and decode asynchronously.
- Export frames are written in bounded batches of eight. The renderer waits for
  the main process before rendering the next batch, which amortizes IPC cost
  without letting an unbounded number of PNG buffers accumulate.
- The main export service accepts ordered batches, writes them together, and
  keeps the single-frame IPC path for compatibility.

## Notes

- PNG encoding is the main cost in export. If future projects need more
  headroom, the next step is to move PNG encoding to a worker and overlap it
  with compositing, not to relax the output format.
- These numbers are a snapshot of one machine. Treat them as a regression
  signal when comparing the same hardware, not as a universal guarantee.
