# Workspace whiteboards

## Ownership

This module owns board validation, element operations, revisions, undo history, file persistence, HTTP routes and the agent action adapter. Workspace catalog data and UI event delivery remain owned by the server composition root.

## Invariants

- Each workspace board is one JSON file under the OpenChamber data directory. Missing storage means no boards; a malformed file is isolated from list results and fails its own read.
- All writes pass through one runtime queue, use atomic replacement and broadcast only after persistence succeeds.
- HTTP responses and agent results never expose inverse history.
- Every element operation is validated before the resulting board is stored, including arrow references and element limits.
- Whiteboards are a beta behind the `whiteboardsEnabled` setting, off by default. `index.js` reads it from disk on every request (`whiteboardsEnabled()`): while off, `registerWhiteboardsRoutes` answers every `/api/openchamber/whiteboards*` route with 404 `disabled` and `createWhiteboardAgentActions` refuses every action. The managed OpenCode loads the whiteboard tool only while it is on (`includeWhiteboard` in `opencode/managed-config-file.js`; the key is in `MANAGED_PLUGIN_SETTINGS_KEYS`, so a change reloads the plugin). Stored boards are never touched by the switch.

## Decisions

### Why element operations use revisions instead of whole-board writes

Element operations let the server reject updates and deletes that target elements changed after the caller's read. Whole-board writes would overwrite concurrent edits without identifying the conflict.

### Why undo is per board and not per actor

The latest stored edit is the board's undo unit, regardless of whether a person or agent made it. This matches the shared board history all workspace sessions observe.

### Why the agent is told about crowded arrow labels instead of boxes being moved

An arrow's label is drawn on its line, so two boxes placed close together hide
it. After the agent creates or changes a board, `crowdedArrowLabels` (in
`model.js`) checks the labelled arrows that touch what changed, and the result
carries `layoutWarnings` naming each arrow, the room its label needs and how
far to move the box. The tool description asks the agent to fix them before
finishing. The server never moves boxes itself: the layout is the author's,
and a person's own placement is not second-guessed. Verify with
`bunx --no-install vitest run server/lib/whiteboards` from `packages/web`.

### Why comments live in the board file but outside element operations

Comments (`comments.js`) are stored with the board, so a board and its
discussion load, move and delete together. They are not elements: they do not
take part in conflicts, undo or the last change, because a note about the
drawing is not an edit of it. A comment change still moves the board revision,
which is how every client learns to reload it. The agent may only reply in a
thread (`whiteboard.comment.reply`); adding, resolving and deleting belong to
the user. Thread and entry counts alone would let one board grow to tens of
megabytes, so `COMMENT_LIMITS.totalText` bounds all its comment text and
`changesPerMinute` bounds how fast its comments change; with one shared
password callers cannot be told apart, so the pace is per board, not per person. Verify with `bunx --no-install vitest run server/lib/whiteboards/comments.test.js`
from `packages/web`.

### Why the agent's reply to an area comment can be refused

An area comment asks for something to be made there, and an instruction alone
did not keep the agent from drawing elsewhere. Moving its elements for it
would break the layout it chose, so instead `whiteboard.comment.reply`
refuses an answer while the agent changed elements since the first entry it
has not answered yet (entries record the board `revision`; only the agent's own
checked answer moves that point, never a later note or a client's `sent`
claim) and none of the elements it made reach the area. The board file keeps
the revisions the agent made (`agentRevisions`, last 200, never sent to
clients), so a box a person draws in the area meanwhile does not count as the
agent's answer; the
refusal says where the area is, and the agent moves its work before
answering. Answers after only deleting, or changing nothing, pass.

### Why each board has one file

Independent files let one malformed board be skipped while other boards remain readable. Atomic writes keep each board's revision and undo history in one durable snapshot.

## Pictures

`images.js` stores board pictures, one folder per board, and only accepts the
raster types their bytes prove (SVG is a document that can run script, not a
picture). `uploads.js` takes uploads in three steps (ticket, bytes, complete):
the bytes stream to a staging file and are cut after 10 s without data or 60 s
in all, so a stalled upload frees its place; a future object store would hand
out its own signed `uploadUrl` in the ticket. Routes authorize before reading an upload body and serve pictures
as their proven type with `nosniff` and a sandboxed CSP. `whiteboard.addImage`
reads an agent-named file only inside the board's workspace folders or the
session's folder, after resolving links. Verify with
`cd packages/web && bunx --no-install vitest run server/lib/whiteboards`.
