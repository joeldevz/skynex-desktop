# Workspace whiteboards (UI)

Boards belong to a workspace and are shared by every chat in it. The server
owns storage, revisions and undo (`packages/web/server/lib/whiteboards`); the
shared contract is `docs/specs/workspace-whiteboards/contract.md`.

## Ownership

| File | Owns |
|---|---|
| `lib/whiteboards/model.ts` | Board schema, element helpers, the text the agent reads with a request (`describeSelectionForAgent`). |
| `lib/whiteboards/images.ts` | Pictures read once per server as object URLs, shared by canvas and thumbnails. |
| `lib/whiteboards/api.ts` | The `/api/openchamber/whiteboards` adapter. Known refusals (`conflict`, `needs-confirmation`) come back as results with the current board; everything else throws. |
| `stores/useWhiteboardsStore.ts` | Boards on screen, the gallery list, the page's open board and workspace filter. |
| `lib/whiteboards/ask.ts` | Sends a request made on a board to the chat on screen, or drafts it in a new chat of the board's workspace. |
| `lib/whiteboards/panel.ts` | Opens a board as a side-panel tab (`whiteboard` mode, board id in `targetPath`/`dedupeKey`). |
| `lib/whiteboards/useWhiteboardEvents.ts` | Live refresh (`openchamber:whiteboard-changed`) and agent requests to show a board (`openchamber:whiteboard-open`), mounted once in `MainLayout`. |
| `WhiteboardCanvas.tsx` | Pan, zoom, select, move, resize from any corner, create, connect, edit, recolor, delete, undo and the ask box. |
| `WhiteboardScene.tsx` | How elements look, shared by the canvas and thumbnails. |
| `WhiteboardChrome.tsx` | Tool dock, zoom controls, request box, working pill and the quick-edit bar. |
| `WhiteboardTextEditor.tsx`, `textEditing.ts` | In-place editor for the formatted text of blocks, notes and texts. |
| `WhiteboardComments.tsx`, `commentText.ts`, `lib/whiteboards/comments.ts` | Comment markers, threads, the new-comment card and the list of all comments. |
| `lib/whiteboards/richText.ts` | The Markdown subset of box text: parse, write back, plain text, whole-text toggles, editor DOM. |
| `WhiteboardsView.tsx` | The Whiteboards page: gallery filtered by workspace, and one board full size. |
| `WhiteboardPanel.tsx` | A board beside the chat, or a picker of the folder's workspace boards. |

## Invariants

- Every change is a list of element operations sent against the revision the
  client last confirmed. The store keeps the server's board and the changes
  not yet answered, and shows the second on top of the first, so a drag shows
  at once. Changes to one board are sent one after another, so a client never
  conflicts with its own edits.
- A refused or failed change is dropped and the board shows what the server
  holds; a failed read never empties the gallery.
- Elements added on the client carry their `el_` id, which the server keeps;
  the selection and the agent then name the same element.
- The server answers a change that deletes every element of a board with
  `needs-confirmation`; the canvas asks the user and retries with
  `confirmReplace`.
- Boards belong to the server they came from: switching runtime resets the store.
- Colors come from theme hues (`whiteboardColors.ts`); boards stay readable in
  every theme.

## Beta switch

Whiteboards are a beta, off by default, switched by the Whiteboards row of
Skynex Tools in Settings (`OpenChamberToolsSettings`, marked with the same
`beta` badge as External tunnel). The setting is `whiteboardsEnabled` in
`useUIStore` and the settings registry; after adding or renaming a registry
field, run `bun run settings-registry:generate` or the server drops the key.
While it is off:

- the sidebar button, the phone's More item and the side panel's Whiteboard
  surface (`whiteboardsShown` in `lib/surfaces/registry.ts`) are gone;
- `setWhiteboardsPageOpen(true)`, `openWhiteboard` and the whiteboard events do
  nothing, and chat cards that came from a board lose their open buttons;
- turning it off closes the Whiteboards page and every board tab.

The server enforces the same switch (see the server module's documentation);
hiding the UI is not the guard.

## Creating boards

The gallery makes boards from one box at its top: what the user writes
becomes the board's title (`boardTitleFrom`), and once the board opens, the
request goes to the agent through the board's own request path
(`firstAsk` on `WhiteboardCanvas`), so it goes to the chat on screen or is
drafted in a new chat of the board's workspace, like any request from the
board. With nothing written, the box makes a blank board. The workspace is
the filter's, else the one of the folder on screen, else the one picked
last. The side panel's picker keeps its own New board button for the
folder's workspace.

## Runtimes

Web, desktop and hosted mobile use the OpenChamber server route and event
stream. VS Code is not a target for whiteboards (maintainer decision); it has
no OpenChamber event stream, so nothing there refreshes boards. Phones
(hosted mobile and the Capacitor app) open the page from the sessions drawer's
More menu as a fullscreen surface (`MobileWhiteboards` in `MobileApp`); a board
the agent asks to show opens there, since a phone has no panel beside the
chat. On touch, a finger on empty board pans, two fingers pinch to zoom, and
a double tap edits text.

## Look

`WhiteboardScene.tsx` draws elements in board units on the canvas;
`WhiteboardThumbnail.tsx` draws the same board on one canvas for the gallery
and the picker: a sheet cut off at the bottom, on a backdrop tinted with the
board's main color (its most used card or note color, `boardTint`), with the
words of each card drawn small. Boards follow the look of diagram tools:

- Blocks are flat pastel cards with dark ink. `blockPaint` pins the lightness
  of the theme hue (`oklch(from …)`), so a card looks the same in dark and
  light themes. Rectangles, rounded cards and pills are one styled element;
  only the diamond and the database are SVG.
- In a block or a note, the first line of a text with several is its title,
  in bold (`BoxText`).
- A section is a thin frame; its name sits above its top edge.
- Arrows run straight or turn at right angles (`routeArrows` and `routeBoard`
  in the model). A route goes around other boxes and avoids a side another
  arrow already uses on the same box. Two boxes that only overlap by a
  sliver get a turn, not a straight line hugging their corners. Arrows are
  routed in board order, so every view and thumbnail draws the same routes.
  On the canvas a line stops short of both boxes and ends in an open chevron.
- Arrow labels are drawn above the boxes. A label sits on its line when the
  run leaves line visible on both sides; otherwise it moves off the line,
  above both boxes for a line that runs across, beside a line that runs down,
  so the arrow never disappears behind its own label.
- The quick-edit bar is one short row: text style, block form and color open
  from their control, then ask the agent and delete.

Chrome over the board (tool dock, zoom, the
request box, the quick-edit bar) is opaque floating surface
(`oc-surface-floating oc-glass-floating`), like the composer. The board layer
is `dir="ltr"`: board coordinates are physical, text inside elements is
`dir="auto"`.

## Editing text

A second press on the same element (double click, double tap) or Enter on a
selected one opens its editor. The board captures the pointer, so the
browser's own `dblclick` never arrives; the canvas counts presses instead, and
stops the mouse press that follows from taking focus away from the new editor
(`keepEditorFocusRef`).

The text of blocks, notes and texts is a Markdown subset, the one Claude's
whiteboards store (`lib/whiteboards/richText.ts`, contract in
`docs/specs/workspace-whiteboards/contract.md`): bold, italic, links and
bulleted or numbered lines. A lone numbered line ("1. Rojo") is a title, not
a list. The editor (`WhiteboardTextEditor.tsx`) is `contenteditable` driven by
the browser's editing commands; it builds its DOM from nodes, never from
markup, turns it back into Markdown on close, and pastes plain text only. A
card's automatic title line opens in bold, and closing without a change saves
nothing. Enter finishes, Shift+Enter starts a new line or list item, Escape
cancels.

The quick-edit bar follows Claude's order: form, size, bold, italic, link,
list, alignment, color, ask, delete. While editing it keeps only the
formatting, which applies to the words picked (its buttons keep focus in the
editor, and its link field keeps the editor open through
`FORMAT_BAR_ATTRIBUTE`). With boxes selected it applies to their whole text.
`size` and `align` are element properties of blocks, notes and texts. Links
open only for http, https and mailto addresses (`safeHref`), through
`openExternalUrl`, on a press on a link of a box that is already selected.

## Comments

Comments follow Claude's whiteboards: a note pinned to an element, a point
or an area, with a thread. The comment tool is the accent button at the end
of the dock: a drag marks an area (drawn dashed while its card is open; the
agent is told to create what the comment asks inside it), a click pins the
comment to the box under it or to the point. The quick-edit bar's comment
button comments on the selection. The card says what the comment is about.

Mentioning @Skynex is what sends a comment to Skynex (`lib/whiteboards/mentions.ts`):
a new comment opens with the mention, typing `@` offers it in a menu like the
chat's, and "Send to Skynex" adds or removes it. The field draws the mention
as a tag through a copy of its text under a transparent textarea, which keeps
typing, the caret and IME input native; threads draw it the same way. Saved comments show as
markers at their element's top-right corner (or their point), with the
agent's spark once it answered; a marker opens the thread, where the user
replies (and can send again), resolves or deletes. The button by the zoom
controls lists every comment, resolved ones on request. On a phone the cards
are a sheet over the bottom of the board.

A comment sent to the agent goes through `onAsk` with its `commentId`
(`askAgentAboutBoard`), so the chat message is a comment card ("Comment on
“…” sent to the agent", `UserContextPart`) whose "View thread" sets
`focusedComment` in the store and opens the board, which opens that thread.
The agent is told to answer in the thread (`whiteboardCommentInstruction`);
the thread shows it working until its answer arrives, since a comment request
is done when the agent replies, not when it edits.

## Pictures

The image tool, pasting and dropping files upload a picture to the board
(`uploadWhiteboardImage`) and add an `image` element that fits in 480 board
units. Pictures are read through `runtimeFetch` and shown from object URLs,
never from a URL carrying credentials. Color picks skip pictures: the server
refuses a color on them.
