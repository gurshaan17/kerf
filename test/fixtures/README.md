# Speech fixture

`caption-speech.wav` is a 16 kHz, mono, 16-bit PCM recording of the repository's
original synthetic test narration:

> Kerf is a local first video editor. This clip has a short caption.

It was generated with macOS speech synthesis and converted to PCM with FFmpeg.
The recording is checked in so tests use real speech without depending on system
voices or network access on the runner. `ensureCaptionFixture` combines it with a
plain video background; FFmpeg and Whisper still run normally in the E2E tests.

To regenerate on a machine with a working English speech voice:

```sh
say -o /tmp/kerf-caption-speech.aiff 'Kerf is a local first video editor. This clip has a short caption.'
ffmpeg -i /tmp/kerf-caption-speech.aiff -map_metadata -1 -ar 16000 -ac 1 -c:a pcm_s16le test/fixtures/caption-speech.wav
```

Run `test/e2e/media-fixture.spec.ts` and the transcription E2E tests after replacing
the recording. The fixture regression test simulates a system voice returning a
10 ms AIFF file, matching the failed GitHub runner, and also checks corrupt cache
recovery.
