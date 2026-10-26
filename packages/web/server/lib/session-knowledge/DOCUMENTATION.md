# Session context

## Ownership

This module refreshes checkout context and managed-tool guidance in OpenCode's
session instruction entries. UI sends use `POST /api/session-knowledge/sync`.
The queue, scheduled tasks and dispatched sessions call the same runtime.

## Invariants

- `openchamber.guidance` describes session linking, task naming, page rendering,
  workflows and direct tool calls only while those capabilities are available.
- `openchamber.checkout` names the session's own directory and checked-out
  branch while the control tool is available. A failed branch read omits the
  key, preserving the previous value. An empty branch explicitly says none is
  checked out. A generated, unpushed placeholder adds the `work.name` rename
  instruction until the branch is renamed.
- `sync` runs before the prompt. It never throws, and a failed entry write
  does not block other entries or discard the message.
- An empty value removes an instruction entry. OpenCode owns compaction,
  revert and fork behavior; this module keeps no delivery history.
- Retired `openchamber.pinned` and `openchamber.memory` instruction entries
  are cleared on sync. Historical notes, todos, plan files, memory files and
  session pin metadata are never read, migrated or deleted here.
- The sync route is the only HTTP route this module registers. It has no
  knowledge summary or pin mutation API.

## Decisions

### Why context lives on the server

Scheduled tasks and dispatched sessions have no browser. A shared server owner
gives every sender the same checkout and capability guidance.

### Why instruction entries replace synthetic messages

OpenCode announces changed entries at the next step and retains them through
compaction. Synthetic messages previously looked like new requests after
compaction and could make weaker models answer the context itself.

### Why retired entry keys are cleared

Existing sessions can retain old injected content. Clearing those two OpenCode
entries stops that content being injected while preserving historical files
and metadata.
