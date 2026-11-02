# Session sidebar

## Ownership

The sidebar presents workspace navigation and the shared application footer. `WorkspaceNavigation` owns saved workspace and explicit open-session references. `SessionSidebar` composes that view with the footer and the session-close presenter. Mobile supplies its drawer shell and runtime-specific actions from `MobileSessionsSheet`.

## Invariants

- Selecting a workspace leaves the current session and directory unchanged. Workspace rows route through the saved selection scope even when global history has not loaded.
- Explicit open-session membership is device-local. Discovering sessions never adds them to that membership.
- Header and keyboard close requests use the durable close helper. Failed closes retain workspace ownership.
- The shared footer stays mounted with workspace navigation and owns the update dialog and application-level navigation actions.
- `useSessionListSync` is the sole sidebar owner of directory bootstrap demands; it must not create a second global polling lifecycle. It demands only the current directory and selected-session directory.
- Sidebar rows come from the global session list. Showing, expanding, or restoring a project never bootstraps that directory; loading and live activity remain governed by `sessionBootstrapDemands` and global status.
- Registered projects follow the project store's fixed order. Unregistered entries such as the Chat target remain ahead of them in their incoming order.
- Subtree archive and delete actions collect the full session lineage before applying the action, so descendants are not left orphaned.
- Sidebar page buttons are toggles: selecting an open page closes it. Scheduled tasks share the same navigation grouping as the other pages.
