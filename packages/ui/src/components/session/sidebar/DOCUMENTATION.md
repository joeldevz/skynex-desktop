# Session sidebar

## Ownership

The sidebar presents workspace navigation and the shared application footer. `WorkspaceNavigation` owns saved workspace and explicit open-session references. `SessionSidebar` composes that view with the footer and the session-close presenter. Mobile supplies its drawer shell and runtime-specific actions from `MobileSessionsSheet`.

## Invariants

- Selecting a workspace leaves the current session and directory unchanged. Workspace rows route through the saved selection scope even when global history has not loaded.
- Explicit open-session membership is server-shared; VS Code uses its durable local fallback. Discovering sessions never adds them to that membership.
- Header and keyboard close requests use the durable close helper. Failed closes retain workspace ownership.
- The shared footer stays mounted with workspace navigation and owns the update dialog and application-level navigation actions.
- A host that supplies its own footer sets `hostOwnsChrome` so `SessionSidebar` does not mount a second footer or page-action row. The navigation shell omits the page-action row when it has no page buttons.
- `useSessionListSync` is the sole sidebar owner of directory bootstrap demands; it must not create a second global polling lifecycle. It demands only the current directory and selected-session directory.
- Sidebar rows come from the global session list. Showing, expanding, or restoring a project never bootstraps that directory; loading and live activity remain governed by `sessionBootstrapDemands` and global status.
- Registered projects follow the project store's fixed order. Unregistered entries such as the Chat target remain ahead of them in their incoming order.
- Subtree archive and delete actions collect the full session lineage before applying the action, so descendants are not left orphaned.
- Sidebar page buttons are toggles: selecting an open page closes it. Scheduled tasks share the same navigation grouping as the other pages.
- Open-session rows show OpenCode's unread watermark only for completed unread top-level sessions; live activity remains the higher-priority indicator. Viewing acknowledgement stays with sync-context's visible, foreground chat owner.
- Open-session order changes only on drag end through the serialized open-session store operation. Dragging does not select, close, or acknowledge a session; failed persistence leaves the server-authoritative order in place and exposes an error.
- A live pending permission shows a static shield-keyhole in the existing status slot before activity or unread markers. Only the pending-request index controls it; opening the session does not clear a permission.
- Successful closes from the open-session list offer Undo for eight seconds. Undo restores the captured membership through the existing store without selecting the chat or restarting a stopped agent. A toast from another runtime cannot reopen a session on the current server; retained or rejected writes display the existing open-session failure message.
