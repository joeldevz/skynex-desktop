# Skynex Tasks

The project's `.skynex/tasks` notebook: the task picker, its steps and
subtasks, and the rows that add a step or create a task. It is read and
written through `lib/skynexTasksApi.ts`; this module owns only how it is shown.

## Ownership

- `SkynexTasksContent` owns the notebook itself. It takes a resolved directory
  and optional host chrome through `className`. Its `collapsible` host uses
  `WorkStatusCollapsibleSection` as the sole Tasks heading.
- `SkynexTasksPanel` is the docked rail surface (`lib/surfaces/registry.ts`,
  `tasks`), rendered by `ContextPanel` in whichever zone the surface sits in.
- Beside the chat, the notebook is a Tasks section inside Session
  (`components/chat/work-status/WorkStatusSectionList`). That module owns the
  section's order, visibility, presence and the card's placement and toggling;
  see its `DOCUMENTATION.md`.

## Invariants

- The picker shows tasks with unfinished steps and new tasks with no steps.
  Completing the last step hides that task and displays the first remaining
  task. Completed records remain in the notebook.
- Both hosts render the same `SkynexTasksContent`. A row, a validation rule or
  a request added for one appears in the other without a second edit.
- The notebook is fetched on mount. In Session it stays mounted when its body
  collapses, preserving task selection and forms. Hiding the section or dropping
  the card after its closing animation unmounts it. No directory means no fetch.

## Decisions

### Why the chat-side notebook is a Session section

Session readouts stay visible alongside task steps. The shared section list
provides ordering, show/hide and collapse controls; a mutually exclusive Tasks
view would hide those readouts, and a second card would consume another column
or cover the transcript.

### Why `SkynexTasksContent` takes a `className` instead of a `variant`

The rail draws its panel edge through `className`. Session supplies the outer
card and asks for a collapsible heading, leaving the notebook body and its
actions shared between both hosts.
