# Design tree: Open sessions organization

## Resolved decisions

- Open sessions can be pinned. Pinned sessions appear in a group at the top of the list.
- The remaining open sessions are grouped by state below the pinned group, in this order:
  - **Waiting for you**: the session asks for a permission or has an unread reply.
  - **Working**: the agent is running.
  - **Paused**: every other open session.
- Each group keeps the user's manual order. A session that changes state moves to its new group but is not reordered within it.

- A pin button appears when hovering a row, and the row's context menu offers the same action. On touch screens the button is always visible.
- A pinned session stays in the pinned group whatever its state and keeps showing its usual indicators.
- Dragging reorders sessions within one group only.
- Group headings appear only when more than one group has sessions.

## Open assumptions

- None.

## Out of scope

- Workspaces list above the open sessions.
- Session history outside the open sessions list.

## Ready for planning

Yes. Implemented.
