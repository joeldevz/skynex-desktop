# Spoken replies

## Ownership

This module owns spoken-summary requests and text preparation. `useMessageTTS`
coordinates generation, reading ownership, and the configured playback provider.
Message actions expose manual playback; automatic reading keeps its existing mode.

Web, Electron, hosted mobile, and Capacitor use the existing OpenChamber server
for generation and their configured voice for playback. VS Code hides the manual
summary action because its bridge does not implement small-model generation.
Mini Chat keeps its existing reduced action set.

## Invariants

- "Listen to summary" requests a concise summary only on a click, regardless of
  reply length or the full-read visibility setting.
- Generation uses the existing small-model route and provider preferences.
  Playback uses the configured voice and existing enterprise enforcement.
- Manual summaries keep the selected speech provider, local model, and voice.
  They bypass automatic language-based voice changes and fail if a selected
  provider or browser voice is unavailable. Other reading modes keep their
  existing fallback and language-following behavior.
- Reading ownership includes a shared preparation phase until audio actually
  starts. Every control under the same key sees that phase and can cancel it.
- Speech providers own cancellation before asynchronous setup begins. Late
  context-resume or audio-decode results cannot start a stopped reading or
  replace the sources owned by a newer reading.
- Failed or empty manual summaries show an error and play nothing. They never
  fall back to reading the full reply.
- Stopping or replacing a reading aborts its manual summary request. A late
  result cannot start playback.
- Browser playback requires a nonempty voice list after discovery. Missing
  voices and failure to start reject playback and show a localized error;
  they cannot leave a reading marked as playing indefinitely.
- Summary text preserves uncertainty and pending work. Model output is speech
  content, never an instruction to run tools.
- Manual summaries and synthesized speech are cached in renderer memory for
  30 minutes from creation. Cache reads do not extend their lifetime.
- Summary reuse requires unchanged source text, generation configuration, and
  runtime context. A speech voice, model, or speed change reuses the summary
  but selects different audio. Changed source text cannot reuse either result.
- Summary retention is bounded to 64 entries and 1 MiB. Decoded speech retention
  is bounded to 64 entries and 32 MiB. Oversized results still play but are not
  retained. Cache entries can be evicted before their time limit to stay bounded.
- Runtime changes clear both caches. Late results from a previous runtime or
  cancelled preparation cannot repopulate them. Failed synthesis and invalid or
  failed summary responses do not become successful cache entries.
- Browser speech synthesis exposes no reusable audio buffer. Its manual summary
  text is cached, while the browser synthesizes each playback. Full reading and
  automatic playback keep their existing behavior.

## Decisions

### Why a separate manual summary

The manual action always requests concise conversational prose. The existing
summarized reading mode retains its length threshold and full-text fallback so
the new action does not change full reading or automatic playback.

### Why browser voice discovery can fail

Firefox on Linux relies on system speech services. Support for `speechSynthesis`
alone does not guarantee usable voices. The application reports playback failure
without installing services or silently selecting a different speech provider.

### Why cache text and audio separately

Repeated manual listening should avoid another model request and another speech
synthesis request. Keeping separate, bounded memory caches lets a voice change
reuse the summary while producing the selected voice. No summary or audio cache
is written to disk, and reloading the renderer clears both.
