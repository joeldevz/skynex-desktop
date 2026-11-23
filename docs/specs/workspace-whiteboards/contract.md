# Workspace whiteboards: shared contract

Boards belong to a workspace and are shared by every session in it. The server
owns storage, revisions and undo; the UI and the agent tool both change a board
through the same element operations.

Whiteboards are a beta behind the instance setting `whiteboardsEnabled`, off
by default and switched in Settings → General → Skynex Tools. While it is off,
every `/api/openchamber/whiteboards*` route answers 404 `disabled`, the agent
gets no whiteboard tool, and the UI shows no way into boards. Boards already
stored are kept and come back when it is turned on.

## Board

```ts
type Color = 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink'
type Size = 'title' | 'heading' | 'body' | 'small'
type Align = 'start' | 'center' | 'end'

type Element =
  | { id: string; kind: 'block'; rev: number; x: number; y: number; w: number; h: number; text: string; color?: Color; form?: 'rect' | 'rounded' | 'diamond' | 'database' | 'pill'; size?: Size; align?: Align }
  | { id: string; kind: 'note'; rev: number; x: number; y: number; w: number; h: number; text: string; color?: Color; size?: Size; align?: Align }
  | { id: string; kind: 'text'; rev: number; x: number; y: number; w: number; h: number; text: string; color?: Color; size?: Size; align?: Align }
  | { id: string; kind: 'section'; rev: number; x: number; y: number; w: number; h: number; text: string; color?: Color }
  | { id: string; kind: 'arrow'; rev: number; from: string; to: string; text: string; color?: Color }
  | { id: string; kind: 'image'; rev: number; x: number; y: number; w: number; h: number; imageId: string; text: string }

type Board = {
  id: string            // 'wb_' + random
  workspaceId: string
  title: string         // 1..120
  revision: number      // starts at 1, +1 per applied change
  createdAt: number     // ms
  updatedAt: number
  elements: Element[]   // order = paint order (later on top); at most 800
  lastChange: { revision: number; actor: 'user' | 'agent'; elementIds: string[]; at: number } | null
  canUndo: boolean
  comments: Comment[]   // at most 200; boards stored before comments existed read as []
}

type Comment = {
  id: string            // 'cm_' + 10 [a-z0-9]
  anchor: { elementId?: string; x: number; y: number; w?: number; h?: number }  // the element it is pinned to and the point it keeps, or an area (w, h from that corner)
  resolved: boolean
  createdAt: number
  updatedAt: number
  entries: Array<{ id: string; author: 'user' | 'agent'; text: string; at: number; sent?: boolean; revision?: number }>  // 1..100
}
```

`rev` is the board revision that last changed the element. Element ids match
`^[A-Za-z0-9_-]{1,64}$`; the server generates `el_` + 10 base36 chars when an
add omits one. Text is at most 4000 characters. `x`, `y` are the top-left
corner in board units, `|x|,|y| <= 1_000_000`; `w`, `h` are 8..20000. An arrow's
`from` and `to` name existing non-arrow elements; deleting an element deletes
its arrows in the same change.

The text of a block, note or text element is a small Markdown subset:
`**bold**`, `*italic*`, `***bold italic***`, `[label](https://…)` links, and
lines starting with `- ` (bulleted) or `1. ` (numbered) as lists. Links open
only for `http:`, `https:` and `mailto:` addresses; any other link shows as
its label. Section names, arrow labels and picture captions show as plain
text. `align` defaults to `center` for blocks and `start` for notes and texts;
`size` defaults to `body`.

## Comments

A board's comments hold at most 200,000 characters of text together, and a
board takes at most 30 comment changes a minute (`rate-limited`, HTTP 429,
beyond that).

A comment is a thread pinned to an element, a point, or an area of the board
(`w` and `h`, 8..20000, both or neither, never with an element); an area marks
where the agent should create what the comment asks for. Its text is plain, at
most 4000 characters, never blank. The UI adds comments, replies, resolves,
reopens and deletes them (`comment`, `reply`, `resolveComment`,
`deleteComment` operations); the agent only replies, as `agent`, through
`whiteboard.comment.reply`. `sent` marks a user entry that was also sent to
the agent as a request. Each entry records the board `revision` it was written at.
The agent's reply to an area comment is refused while it changed elements
since the first entry it has not answered but none of the elements it made
reach the area (the server keeps which revisions the agent made; a box a
person adds in the area meanwhile does not count), so what it makes
lands where the comment points. A reply reopens a resolved comment. Comment changes
move the board's `revision` and `updatedAt`, so every client reloads the
board, but they are not element operations: they leave `lastChange` and undo
untouched, and an element deleted under a comment leaves the comment at its
point.

## Operations

```ts
type ElementInput = Omit<Element, 'rev' | 'id'> & { id?: string }
type Op =
  | { op: 'add'; element: ElementInput }
  | { op: 'update'; id: string; set: Partial<Omit<Element, 'id' | 'kind' | 'rev'>> }
  | { op: 'delete'; id: string }
```

An apply carries `baseRevision` (the revision the caller last read) and up to
400 ops, applied in order, all or nothing. An add may reference ids added
earlier in the same apply. Conflicts: an update or delete on an element whose
`rev` is greater than `baseRevision` fails the whole apply with `conflict`.
An apply that would delete every existing element of a board with at least 3
elements fails with `needs-confirmation` unless `confirmReplace: true`.

Every applied change records its inverse for undo (at most 30 kept). Undo
reverts the most recent recorded change of the board, whoever made it, and
fails with `conflict` when an element it would touch changed after that
change. Undo itself is not recorded.

## HTTP

`POST /api/openchamber/whiteboards`, authorized like the other OpenChamber
routes, JSON body `{ operation, ... }`:

| operation | input | 200 response |
|---|---|---|
| `list` | `workspaceId?` | `{ boards: Board[] }` newest `updatedAt` first |
| `read` | `boardId` | `{ board }` |
| `create` | `workspaceId`, `title`, `elements?: ElementInput[]` | `{ board }` |
| `apply` | `boardId`, `baseRevision`, `ops`, `confirmReplace?` | `{ board }` |
| `undo` | `boardId` | `{ board }` |
| `rename` | `boardId`, `title` | `{ board }` |
| `delete` | `boardId` | `{ deleted: true }` |

Errors answer `{ error, code }`: 400 `invalid`, 404 `not-found` (board or
workspace) or `disabled` (the beta is off), 409 `conflict` or `needs-confirmation` (with the current `board`),
500 `unavailable`. Routes act as `actor: 'user'`.

## Events

After every stored change the server broadcasts on the OpenChamber UI event
stream `{ type: 'openchamber:whiteboard-changed', properties: { boardId,
workspaceId, revision, actor, deleted } }`. The agent tool's `whiteboard.open`
broadcasts `{ type: 'openchamber:whiteboard-open', properties: { boardId,
workspaceId, sessionID } }`, which the UI answers by opening the board beside
that session's chat.

## Agent tool

`skynex_whiteboard`, one action per call, acting as `actor: 'agent'`:
`whiteboard.list`, `whiteboard.read`, `whiteboard.create`, `whiteboard.apply`,
`whiteboard.undo`, `whiteboard.open`. Without `workspaceId`, list and create use
the workspace whose folders contain the calling session's directory.

## Images

An `image` element shows a picture stored for its board; `text` is its caption.
Pictures are PNG, JPEG, GIF or WebP (proven by their bytes, SVG refused), at
most 10 MB, stored at `<OPENCHAMBER_DATA_DIR>/whiteboards/images/<boardId>/`.
An add naming an `imageId` not stored for that board is refused; deleting the
board deletes its pictures. Updates may change position, size and caption only.

Uploads take three steps, the shape object stores use, so a future store
(S3 or similar) only changes where step 2 goes:

1. `POST /api/openchamber/whiteboards/images/:boardId/uploads` → `{ upload: { uploadId, method: 'PUT', uploadUrl, headers, completeUrl, maxBytes, expiresAt } }` (single use, expires in 5 minutes, at most 16 open)
2. `PUT uploadUrl` with the raw bytes (here: streamed to a staging file; cut after 10 s without data or 60 s in total; at most 4 at once, 429 otherwise)
3. `POST completeUrl` → `{ image: { imageId, width, height, mime } }` once the bytes prove a supported picture within the board's quotas
- `GET /api/openchamber/whiteboards/images/:boardId/:imageId` → the picture, `nosniff`, sandboxed CSP

Agent action `whiteboard.addImage` `{ boardId, path, x?, y?, w?, caption? }`
reads a picture file inside the board's workspace folders or the calling
session's folder (after resolving links), stores it and adds the element.
