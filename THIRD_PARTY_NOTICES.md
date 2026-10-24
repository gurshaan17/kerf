# Third-party notices

Kerf is MIT-licensed. It depends on third-party software and invokes external
media tools. This file summarizes the direct dependencies and the licences that
apply when Kerf is used or redistributed.

The authoritative licence text for each package is the one shipped in that
package (usually `node_modules/<package>/LICENSE`). Run `pnpm licenses list`
for the resolved dependency set in a checkout.

## Application runtime

| Component | Licence                      | Notes                                                          |
| --------- | ---------------------------- | -------------------------------------------------------------- |
| Electron  | MIT                          | Desktop runtime                                                |
| Chromium  | BSD-style and other licences | Bundled with Electron; see Electron's `LICENSES.chromium.html` |
| Node.js   | MIT                          | Bundled with Electron                                          |

## Direct dependencies

| Package                     | Licence       | Used for                        |
| --------------------------- | ------------- | ------------------------------- |
| `react`, `react-dom`        | MIT           | Renderer UI                     |
| `zustand`                   | MIT           | Renderer state                  |
| `better-sqlite3`            | MIT           | SQLite driver                   |
| SQLite                      | Public domain | Embedded database engine        |
| `zod`                       | MIT           | Schema validation               |
| `acorn`                     | MIT           | Motion composition parsing      |
| `lucide-react`              | ISC           | Interface icons                 |
| `tailwind-merge`            | MIT           | Class composition               |
| `tailwindcss`               | MIT           | Styling                         |
| `ai`                        | Apache-2.0    | Agent runtime                   |
| `@ai-sdk/openai`            | Apache-2.0    | OpenAI provider adapter         |
| `@ai-sdk/anthropic`         | Apache-2.0    | Anthropic provider adapter      |
| `@ai-sdk/google`            | Apache-2.0    | Google Gemini provider adapter  |
| `@ai-sdk/xai`               | Apache-2.0    | xAI provider adapter            |
| `@ai-sdk/openai-compatible` | Apache-2.0    | Ollama and compatible endpoints |
| `@modelcontextprotocol/sdk` | MIT           | MCP server and bridge           |
| `electron-squirrel-startup` | Apache-2.0    | Windows install shortcuts       |

## Build and test toolchain

| Package                          | Licence    | Used for                    |
| -------------------------------- | ---------- | --------------------------- |
| `electron-forge` packages        | MIT        | Build and packaging         |
| `@electron/fuses`                | MIT        | Electron fuse configuration |
| `vite`                           | MIT        | Bundler and dev server      |
| `vitest`                         | MIT        | Unit tests                  |
| `@vitest/coverage-v8`            | MIT        | Coverage                    |
| `playwright`, `@playwright/test` | Apache-2.0 | Electron end-to-end tests   |
| `typescript`                     | Apache-2.0 | Type checking               |
| `oxlint`, `oxfmt`                | MIT        | Lint and format             |

## Bundled fonts

The interface ships three variable font families under the SIL Open Font
License 1.1. The full licence text for each family is stored beside its binary
in `packages/ui/src/fonts`:

| Family          | File                          | Licence                                |
| --------------- | ----------------------------- | -------------------------------------- |
| Fraunces        | `fraunces-latin.woff2`        | SIL OFL 1.1 (`OFL-Fraunces.txt`)       |
| Instrument Sans | `instrument-sans-latin.woff2` | SIL OFL 1.1 (`OFL-InstrumentSans.txt`) |
| JetBrains Mono  | `jetbrains-mono-latin.woff2`  | SIL OFL 1.1 (`OFL-JetBrainsMono.txt`)  |

Only the Latin subsets are bundled.

## Audit

The resolved dependency set was reviewed with `pnpm licenses list --long` before
the first source release. It contains MIT, ISC, Apache-2.0, BSD-2-Clause,
BSD-3-Clause, BlueOak-1.0.0, MPL-2.0, and dual-licensed packages. There are no
GPL, AGPL, SSPL, or unknown licences. MPL-2.0 appears only in `lightningcss`, a
transitive build-time dependency of Tailwind CSS; Kerf does not distribute it as
application source.

## External tools

Kerf invokes tools installed on the user's machine. It does not distribute
them in this repository.

- **FFmpeg / ffprobe** — Kerf calls the user's binaries for probing, proxies,
  thumbnails, waveforms, scene detection, audio extraction, and encoding.
  FFmpeg is licensed under the LGPL-2.1-or-later by default; builds that enable
  GPL components are GPL. The licence of the installed build applies.
- **whisper.cpp** — Kerf calls a user-installed `whisper-cli` binary for local
  transcription. whisper.cpp is MIT-licensed.
- **Whisper models** — Model files are downloaded on demand from Hugging Face
  and are not part of this repository. The model card and the whisper.cpp
  project describe their terms.

## Redistribution

If you redistribute a packaged Kerf build, include:

- This file.
- The MIT licence in [LICENSE](LICENSE).
- The three SIL OFL texts from `packages/ui/src/fonts`.
- The licence texts for Electron, Chromium, Node.js, and every bundled native
  module.
- The licence texts for any FFmpeg or whisper.cpp binary you choose to bundle
  yourself. The default Kerf configuration does not bundle them.

Nothing in this file changes the licence of Kerf itself or grants rights beyond
those in the applicable third-party licences.
