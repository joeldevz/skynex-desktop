# Design tree: Scheduled task targets

## Resolved decisions

- D1: Reuse the composer's target choices: a workspace with all its folders, one folder in a workspace, or Chat without a workspace association.
- D2: Create a new conversation for each execution by default. Offer continuing an existing conversation as an explicit alternative.
- D3: A task targeting all workspace folders resolves the current folder membership at execution time. Later additions and removals affect subsequent executions.
- D4: A task targeting one folder becomes blocked with an actionable message if that folder is unlinked. It does not silently switch targets.
- D5: Deleting a workspace pauses and preserves its scheduled tasks. They require a new destination before resuming and do not become unassociated Chat tasks automatically.
- D6: Preserve the current folder destination of existing project-based tasks during migration.
- D7: Keep the existing schedule, prompt, model, and agent controls.

## Open assumptions to validate before planning

- A1: Existing-conversation execution must preserve the conversation's captured scope. Determine how the target controls represent that scope without expanding it.
- A2: Unassociated Chat currently has its own execution-directory behavior. Preserve it unless an incompatible requirement is found; absence of a workspace association does not itself remove runtime directory requirements.
- A3: Verify a migration for existing project-based task storage, including tasks whose folder is not currently in a workspace. Preserve tasks without guessing workspace membership.
- A4: Reuse authoritative runtime access checks for each execution. Workspace membership alone grants no additional access.

## Out of scope

- Renaming or removing OpenCode project identities and per-directory configuration contracts.
- Changing scheduler frequency, missed-run recovery, concurrency limits, or execution timeout policy.
- Implementing or publishing this design as part of the alignment conversation.

## Ready for planning

Product choices are resolved. Technical planning must validate A1 through A4 against the current scheduler and workspace implementation. This document records requirements, not implementation progress or authorization.
