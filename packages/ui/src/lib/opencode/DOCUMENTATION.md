# OpenCode usage statistics

`session-stats.ts` translates OpenCode's aggregate `session.stats` response and provides workspace-scoped reports using the official session-list and message-list APIs.

## Invariants

- Wire and domain message shapes remain within `lib/opencode`.
- Workspace membership comes from captured workspace scope first, then explicit legacy assignment, and then the parent chain. Directory or project IDs do not infer workspace membership.
- Every selected session history must finish successfully before a workspace report is returned. A failed page is an error, never a partial or empty success.
- Session and message pagination observes abort signals. The caller bounds concurrent histories.
- Message routes use the official message group without location middleware. Finite session-log usage reads pass a combined caller/deadline signal, enforce the 30-second request timeout through stream consumption, and reject after abort even if the SDK ends iteration silently. Only in-range `session.usage.recorded` compaction events add tokens and cost.
- Tool-call details are computed only after the person requests them.

### Why reports are aggregated from messages

OpenCode's aggregate route cannot filter by workspace or session ID. The official message history carries the model, token, cost, and tool-part records required for scoped totals. Metric parity follows OpenCode 2.1.4's `SessionStats.get`: https://raw.githubusercontent.com/anomalyco/opencode/v2.1.4/packages/core/src/session/stats.ts. The versioned API adds `MessageGroup` without location middleware and the message handler reads via `Session.Service.messages`: https://raw.githubusercontent.com/anomalyco/opencode/v2.1.4/packages/protocol/src/api.ts and https://raw.githubusercontent.com/anomalyco/opencode/v2.1.4/packages/server/src/handlers/message.ts.
