# Skynex Tasks

The project's `.skynex/tasks` notebook: the task picker, its steps and
subtasks, and the rows that add a step or create a task. It is read and
written through `lib/skynexTasksApi.ts`; this module owns only how it is shown.

## Ownership

- `SkynexTasksContent` owns the notebook inside the Work Status section and
  takes a resolved directory. `WorkStatusCollapsibleSection` is its sole Tasks
  heading.
- Beside the chat, the notebook is a Tasks section inside Work Status
  (`components/chat/work-status/WorkStatusSectionList`). That module owns the
  section's order, visibility, presence and the card's placement and toggling;
  see its `DOCUMENTATION.md`.

## Invariants

- The picker shows tasks with unfinished steps and new tasks with no steps.
  Completing the last step hides that task and displays the first remaining
  task. Completed records remain in the notebook.
- The notebook is fetched on mount. It stays mounted when its body
  collapses, preserving task selection and forms. Hiding the section or dropping
  the card after its closing animation unmounts it. No directory means no fetch.

## Decisions

### Why the notebook is a Work Status section

Session readouts stay visible alongside task steps. The shared section list
provides ordering, show/hide and collapse controls; a mutually exclusive Tasks
view would hide those readouts, and a second card would consume another column
or cover the transcript.

### Why the notebook heading belongs to Work Status

The shared Work Status section keeps task controls in the same column as the
session readouts; a separate heading or card would split that context.
