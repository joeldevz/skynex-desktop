# Skynex Memory

Owns the server side of the Memory surface: the `/api/skynex/memory` routes and the
calls to the local `neurox` CLI that list, search and save the owner's Neurox
memory for one project. The UI client is `packages/ui/src/lib/skynexMemoryApi.ts`.

## Invariants

- The namespace is the basename of the project directory, taken from the validated
  `resolveProjectDirectory(req)` result. It is never taken from the body.
- Execution is argv-only (`execFile`, no shell) with the `neurox` binary resolved
  from `PATH`. Free text (query, note fields) is one argv element; any value that
  starts with `-` or contains control characters is refused.
- A save always writes the four-part content `What / Why / Where / Learned`, built
  by the server from the four fields. The title is the `What` field, cut to 120
  characters.
- Each call is bounded: 15 s timeout and a 1 MiB output cap. Timeouts return 504,
  a missing binary returns 503, and output that does not match the expected shape
  returns 502. A list failure is never shown as an empty list.
- CLI output is read from stdout only. Logs go to stderr and are never returned or
  logged by this module, because the stored memory is the owner's data.
- Calls run one at a time, the same as the Tasks service.

## Decisions

### Why the note is built on the server and not the client
The owner's format is fixed. If the client assembled it, any caller could store a
note that breaks the shape, and the server could not check it.

### Why the title is positional and comes first
The CLI usage line is `neurox save "title" --content ... [flags]`, and recall is
`neurox recall "query" [flags]`. Placing the free text first avoids a value being
read as a flag.

### Why the response shape is read strictly
`neurox context` returns `{namespace, count, items}` and `neurox recall` returns
`{count, query, results}`, as observed with an empty namespace. The observation
fields (`id`, `content`, `title`, `observation_type`, `created_at`) come from the
binary's JSON tags, not from a stored record. A result that does not match fails
with 502 so the shape can be fixed in one place. This is not yet checked against a
non-empty result.
