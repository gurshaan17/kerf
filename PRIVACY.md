# Privacy

Kerf is local-first. The default install does not create an account, collect
telemetry, upload footage, or call a cloud service. The only network activity
comes from a feature you explicitly configure or invoke.

## What stays on this machine

- Project documents and the SQLite database
- Absolute paths, sizes, and hashes of source media
- Generated proxies, thumbnails, waveforms, keyframes, and exports
- Transcripts, scenes, beat maps, reference profiles, and compositions
- The edit log, job queue, and export history
- Provider labels, model names, and per-account consent flags
- MCP settings and activity

API keys and the MCP bearer token are encrypted with the operating system
credential store through Electron `safeStorage`. If the credential store is
unavailable, Kerf refuses to save the secret rather than writing it in plain
text.

Kerf does not copy your source media into the project. It stores a reference to
the file where it already lives.

## When the network is used

### Provider accounts

You can add OpenAI, Anthropic, Google Gemini, xAI, Ollama, or an
OpenAI-compatible endpoint in **AI settings**. Each account has two independent
consent flags:

- **Vision** — allows selected keyframes and a description prompt to be sent
  for scene descriptions.
- **Chat** — allows the conversation and the tool context needed to answer it
  to be sent to the chat provider.

Only the provider you enable and consent to is used. Kerf does not proxy
requests through its own server, log prompts or responses, or fall back to a
different provider. The provider's own privacy policy applies to what it
receives.

Ollama and OpenAI-compatible endpoints can point at a local server such as
`http://127.0.0.1:11434/v1`, in which case no traffic leaves the machine.

### Whisper model downloads

Transcription runs locally through `whisper.cpp`. If you install a model from
**AI settings**, Kerf downloads that model file from Hugging Face. Nothing else
is sent. The model is stored in the app's user-data folder and can be deleted
from the same panel.

### MCP

The MCP server is disabled by default. When enabled, it binds to `127.0.0.1`
only and requires a bearer token. It does not contact an external service. An
MCP client on the same machine connects to the loopback endpoint; the client's
own behaviour and privacy policy are outside Kerf's control.

### Everything else

Kerf has no analytics, crash reporting, update check, or hosted sync. The
renderer's Content-Security-Policy allows only local resources (plus the Vite
development server in development). Navigation and popups are denied.

## What Kerf never does on its own

- Create an account or identify you.
- Upload footage, transcripts, or project files.
- Send a prompt to a provider you did not configure and consent to.
- Switch providers after a failure.
- Enable the MCP server.
- Download a Whisper model.

## Retention and deletion

- **Delete a project** removes its project folder, generated caches, and
  database rows. Source media stays where it is.
- **Delete a provider** removes the account row and its encrypted key.
- **Rotate the MCP token** invalidates the old token and closes active
  sessions.
- **Delete a Whisper model** removes the model file from the app's user-data
  folder.

Uninstalling the app does not automatically remove the Electron user-data
folder or your project folders. Delete those directories if you want a full
wipe.

## Development and tests

Development console output can include local paths and timing information. It
is not uploaded. The end-to-end suite uses temporary directories and a test
database, and removes them when the test finishes. The Playwright artifacts
uploaded by CI on failure may contain screenshots and traces from the test
fixture; they are retained according to the repository's CI settings.

## Changes

If a change adds a network call, a new stored field, or a new third-party
service, update this page and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
in the same pull request.

Questions or concerns: open an issue in the repository.
