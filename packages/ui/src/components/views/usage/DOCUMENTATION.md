# Usage reports

The Stats view owns range and workspace selection, refresh state, and cached report presentation. `usageStatsStore.ts` keys reports and requested tool details by runtime, range, and workspace selection.

## Invariants

- The all-workspaces selection uses OpenCode's aggregate statistics endpoint.
- A workspace report enumerates the runtime's complete session list, resolves membership from captured workspace scope and explicit legacy assignment, inherits membership through session parents, then reads selected histories through `opencodeClient`.
- Sessions with missing or stale workspace IDs belong to No workspace. Folder overlap does not assign a session; captured membership remains authoritative.
- A failed session or message page rejects the report. Partial totals never replace a successful report or render as an empty result.
- Session and message reads are paginated, bounded to four concurrent session histories, and scoped to the active runtime. Abort and runtime reset prevent stale results from committing.
- Tool details remain on demand. The all-workspaces report continues to use OpenCode's aggregate endpoint and its tool scan.
- Root session counts include root sessions with an in-range user or assistant message. Subagents count separately; only root user messages count as prompts. Fork history before the fork session's creation time is excluded. Compaction usage contributes tokens and cost without adding steps, model usage, or activity.

### Why workspace reports read session histories

OpenCode's aggregate statistics route has no session or workspace filter. Workspace membership is stored on session metadata, so the client reads the complete session inventory and only scans histories selected by that metadata. Metric semantics follow OpenCode 2.1.4 `packages/core/src/session/stats.ts`: https://raw.githubusercontent.com/anomalyco/opencode/v2.1.4/packages/core/src/session/stats.ts.
