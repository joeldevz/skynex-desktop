# Design tree: spoken reply summary

## Resolved decisions

- Each assistant reply offers a manual "Listen to summary" action.
- A click generates and speaks a concise conversational account of the reply.
  Include the work, result, and pending items when present.
- Length follows the meaning. Use the fewest useful words, with extra detail
  only when needed.
- Generation happens on demand. Automatic reading and full reading retain
  their current behavior.
- A shared loading indicator remains visible during generation and audio
  preparation. It stops when playback starts, fails, or is cancelled.
- Manual summaries use the selected speech provider, model, and voice without
  automatic language-based substitution or fallback to a different provider.
- Reuse the existing small-model route and configured playback voice.
- A failed summary shows an error and plays nothing.

## Open assumptions

None.

## Out of scope

- New providers, voice models, or configuration settings.
- Automatic summary generation or playback.
- Changes to the original reply or conversation history.

## Ready for planning

Yes. Product behavior was agreed in the conversation.
