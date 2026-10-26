# Skynex Tasks

Owns the server side of the Tasks surface: the `/api/skynex/tasks` routes and the
calls to the local `skynex task` CLI that read and write a project's task notebook.
The UI client is `packages/ui/src/lib/skynexTasksApi.ts`.

## Invariants

- The notebook is `<project directory>/.skynex/tasks`. Every CLI call passes it as
  `--tasks-root` with `--json`, so the CLI never picks a root from its own working
  directory.
- The project directory comes from `resolveProjectDirectory(req)`, the same
  validated directory every feature route uses. It is never taken from the body.
- Execution is argv-only (`execFile`, no shell). Every task id, step id and title
  is validated before it reaches argv; titles may not start with `-`.
- Each call is bounded: 10 s timeout and a 1 MiB output cap. A timeout returns 504,
  a missing or non-executable CLI returns 503, and output that does not match the
  expected shape returns 502. None of these is reported as an empty list.
- A missing notebook reads as zero tasks. Only a write creates the directory tree,
  and a symlinked `.skynex` or `tasks` directory is refused (503).
- All CLI calls for the service run one at a time, so reads never interleave with
  a write on the same notebook.
- A step's `parent` is `null` for a top-level step or a step id. Subtasks are one
  level deep: a new step's `parent` must name a top-level step of the same task,
  and it is validated before it reaches argv (`--parent`).

## Decisions

### Why the notebook is per project and not a fixed sandbox
The prototype wrote to a sandbox inside `.git`. Tasks belong to the project they
were made for, so the directory from the request selects the notebook. A fixed
sandbox would mix tasks from every project in the app.

### Why reads do not create the notebook
A GET that writes files on first load would change a project on view. Only
creating a task makes the `.skynex/tasks` tree.

### Why subtasks are one level and not a tree
The CLI accepts `--parent` only for a top-level step. The UI shows subtasks indented under their parent, and a step whose parent is missing stays top level so it is never hidden.

### Why the step scope is still `sandbox`
The CLI requires `--scope`, `--done-when` and `--evidence`. The prototype's values
are kept unchanged. `sandbox` is a label, not a path, and is an open question for
the owner before a release.
