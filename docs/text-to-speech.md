# Configurable narration voice-over

## User workflow

Open an existing visual narration draft and expand **Generate voice**. Add a speech provider, enter its voice and credentials, and save. Select a narration row or all rows, then choose **Send text and generate voice**. This explicitly sends saved text to the selected provider and may incur provider charges. Jobs show progress and support cancellation.

Generated takes remain available after project reopening. Listen to each take, compare its duration with the narration interval, then choose **Add / update voice-over**. The source range must already appear on the timeline at normal speed. A timeline update is one undoable batch. A later generation creates another take; it does not replace timeline audio until explicitly placed.

## Provider contract

Each saved account has a label, adapter kind, model or engine where applicable, voice, language, speed, region, and optional custom endpoint. Multiple configurations of the same vendor are supported. OpenAI and Gemini models are selected from curated dropdowns; other vendors use explicit model identifiers. Voices are entered using the selected vendor's identifiers.

| Adapter                     | Credentials                                                                 | Configuration                                                     | Output |
| --------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| OpenAI                      | API key                                                                     | Select a Speech API model and enter a built-in voice              | MP3    |
| Gemini                      | Gemini API key from Google AI Studio                                        | Select a Gemini TTS model and enter a voice such as `Kore`        | WAV    |
| AWS Polly                   | JSON containing `accessKeyId`, `secretAccessKey`, optional `sessionToken`   | AWS region, voice ID, language code, engine (`neural` by default) | MP3    |
| Google Cloud Text-to-Speech | API key or service-account JSON containing `client_email` and `private_key` | Full voice name and matching language; voice selects the model    | MP3    |
| Smallest.ai                 | API key                                                                     | Voice ID, model (`lightning_v3.1` by default), language           | WAV    |
| LemonFox.ai                 | API key                                                                     | Voice and language (for example `en-US`)                          | MP3    |
| OpenAI-compatible           | API key                                                                     | Full speech endpoint URL, model and voice                         | MP3    |

AWS credentials require Polly synthesis permission. Service-account Google authentication exchanges a signed JWT for a short-lived OAuth access token. Provider support for voices, engines and speaking rates varies; API errors explain whether credentials, quota, or configuration needs attention. AWS generative voices require speed 1 in this implementation.

OpenAI model options are `gpt-4o-mini-tts`, `gpt-4o-mini-tts-2025-12-15`, `tts-1`, and `tts-1-hd`. OpenAI currently schedules these Speech API models to retire January 6, 2027; availability depends on the account. OpenAI's native entry uses its fixed speech endpoint and requires no custom URL.

Gemini options are `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`, `gemini-3.1-flash-tts-preview`, and `gemini-2.5-pro-preview-tts`. The default is Gemini 3.8 Flash TTS. Gemini 3.8 WAV responses are saved directly; preview-model PCM responses are wrapped in a WAV header for normal project import. Gemini uses its default pace (speed 1); it has no numeric speed control here. Native OpenAI and Gemini infer language from the narration text.

Custom endpoints must accept the synchronous JSON speech contract `{input, model, voice, response_format: "mp3", speed}`, Bearer authentication, and return audio bytes directly. HTTPS is required except for HTTP on loopback. URL credentials, queries, fragments, and redirects are rejected. An arbitrary vendor key works only through a matching adapter or this compatible contract. Async polling APIs and streaming playback need additional adapters.

## Main-process ownership

`src/shared/tts.ts` defines validated input contracts. The sandboxed preload exposes only provider list/save/delete, generation enqueue, take listing and placement. Provider credentials are encrypted with Electron's OS-backed `safeStorage`; saves fail if secure storage is unavailable. List/save responses expose `hasCredentials` and never expose saved credentials. Blank credential input preserves a saved secret. Changing adapter or endpoint requires entering credentials again. Deleting an account removes its credential record but preserves generated audio.

Fixed vendor endpoints are owned by adapters, so credential JSON cannot redirect OAuth tokens or speech requests to another host. AWS requests use SigV4. Provider/network errors omit response bodies and raw fetch errors. No credentials enter job payloads, takes or project files. Account records are device-local, outside project folders.

## Generation and lifecycle

Each row becomes one `narration.tts` job using the existing persistent queue. Requests include transcript and segment IDs, expected transcript revision, and provider ID. Queueing verifies ownership and rejects another queued/running job for the same row. It captures a hash of provider configuration and encrypted credentials, and checks this hash before and after synthesis. It also checks project session, transcript revision and source identity. Closing or reopening a project cancels queued/running speech work. Interrupted work requires a new generation request.

Synthesis has a 120-second deadline, a 30 MiB response limit, and a conservative 2,800 UTF-8 byte limit per row in addition to the narration text limit. Long rows must be split. Generation does not automatically retry or choose another provider, avoiding surprise duplicate charges.

Audio is written under `assets/voiceover/` in the project folder, validated with ffprobe, and passed through ordinary media import for playback and waveform support. Files that fail before import are removed. If work is invalidated after import starts, an unused imported asset can remain in Footage; it is never silently placed on the timeline.

## Persistence and stale takes

SQLite migration 7 adds `tts_accounts` for encrypted account configuration and `tts_takes` for generated-take metadata. Each take records its project, transcript, segment, exact text, provider ID, voice, model, speed, audio asset ID, creation time, and placement linkage. Foreign keys delete take metadata with its owning project or transcript. Ordinary project media persists independently of provider-account deletion.

A text change marks older takes stale; placement checks exact text again in main. Timing edits retain reusable speech, but placement checks its duration against the current interval. Provider changes leave previous takes playable and do not alter their audio. The current implementation records voice settings for reference but does not automatically regenerate old takes when a provider changes.

## Timeline semantics

Source row frames are converted through seconds into sequence frames. Kerf uses the first matching normal-speed video occurrence that fully contains the narration interval. Rows spanning a trim, a speed change, or a time map need manual timing adjustment. Repeated source occurrences are not independently selectable yet.

The imported audio must be ready. Speech must fit the current interval; overflow blocks placement with an actionable error. Kerf never truncates speech or shifts later footage to make it fit. Placement reuses an unlocked Voice-over audio track with space, or creates one. Updating removes previously linked row clips and inserts the chosen take in one undoable batch. Locked previous tracks block updates. Other audio remains available for manual editing and mixing through the existing editor.

## Acceptance and verification

- Account credentials persist encrypted, are retained on blank edits, and never appear in public responses.
- All seven adapters produce the documented native request and normalize audio responses.
- Provider failures, redirects, oversized bodies, and insecure custom endpoints fail safely.
- Stale revisions, duplicate row jobs, changed provider settings, and project closure prevent invalid commits.
- Takes preview as normal audio assets; outdated text and duration overflow prevent placement.
- Source and sequence frame rates, source trims, and undoable clip updates preserve alignment.

Focused adapter and service tests cover these mechanics with local fixtures and mocked provider responses. They do not establish live account permissions, model/voice availability, voice quality, or provider billing. Live synthesis needs user credentials.

The Electron desktop journey covers visual narration generation, editing, captions, provider configuration through the UI, speech requests to a local fixture, real ffmpeg audio import, preview availability, timeline placement, and Undo.

## Provider references

- [OpenAI speech API and model availability](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)
- [Gemini TTS models and response formats](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation)

- [AWS SynthesizeSpeech](https://docs.aws.amazon.com/polly/latest/APIReference/API_SynthesizeSpeech.html) and [SigV4 signing](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html)
- [Google voice parameters](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/VoiceSelectionParams) and [service-account authentication](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Smallest synthesis API](https://docs.smallest.ai/api-reference/models/text-to-speech/synthesize-speech)
- [LemonFox speech API](https://www.lemonfox.ai/apis/text-to-speech)
