# Workspace overview

## Ownership

The overview edits one workspace through callback props. The parent owns folder picking, persistence, session creation and navigation. Model and agent options come from the parent. This component makes no runtime requests.

`WorkspaceNavigation` binds catalog selection and explicit membership. Its header holds the sidebar page toggles. `WorkspaceSurface` connects the editor to acknowledged catalog writes and `openWorkspaceDraft`. Add folders opens the same directory explorer that adds projects (path field with completion, folder list, checkboxes, quick add, hidden toggle, keyboard), in its folder-pick mode: folders already in the workspace show as added, the clone action and the existing-repository identity step are gone, and a path that does not exist cannot be submitted. Each picked path is read through the runtime files API before it is linked, and no project, clone or directory is created. VS Code offers existing editor roots only, through the plain root list. Catalog reads address only the overview's primary folder; creation validates defaults against its selected primary folder.

`WorkspaceNavigation` owns the view shell and its pinned footer slot. The parent supplies the sidebar footer and its controller once, outside the overview scroller. Hosts without page buttons omit the navigation row.

The navigation row above the workspace list holds the sidebar's page toggles: Overview and Issues and PRs (desktop only), Archive, the integrations catalog (not in enterprise mode) and Scheduled tasks. `SessionSidebar` supplies them as `pageButtons`, each pressed while its page is open.

The scheduled-task view uses workspace and folder rows as virtual scopes over
the Chat task store. Selecting a workspace includes its folders; selecting a
folder narrows the target. The task's storage owner remains Chat for these
scopes, while legacy project-owned tasks remain in their separate compatibility
group.

## Invariants

- The editor has Home, Folders, Sessions and Scheduled tasks tabs. Only the active editor panel occupies space. Panels stay mounted so tab changes retain unsaved fields. Switching editor tabs performs no writes. Sessions lists root conversations associated with the workspace folders, including archived sessions, and filters by folder. Listing does not open sessions or alter membership; opening a legacy unscoped root session persists its workspace assignment before navigation. Global Session history access remains removed. Selecting Scheduled tasks opens the shared scheduler with the current workspace preselected; the mobile app routes through its app-surface action so the inline workspace dialog cannot cover the scheduler. Closing the scheduler returns the editor to Home. Errors and deletion confirmation remain outside the panels.
- Name, description, roles and defaults remain in a draft until Save. Folder unlinking writes immediately through the acknowledged catalog operation; a retained write keeps the folder visible and exposes an error. An acknowledged unlink removes only that folder and preserves unrelated unsaved draft fields.
- The workspace header action opens a new composer draft with all saved folders selected. A folder-row action opens a new draft with only that saved folder selected. The parent validates scope and defaults before opening the draft.
- Creation uses saved workspace defaults. Saving the draft updates the defaults used by later sessions when the parent supplies the acknowledged workspace.
- Parent workspace updates replace the local draft. Existing session snapshots remain the parent's responsibility.
- Workspace deletion requires a modal confirmation naming the saved workspace and explaining that only its grouping and configuration are removed. Cancel and dismissal perform no mutation. Pending actions are disabled, and a failed deletion keeps the confirmation and error visible.
- The overview has no filesystem creation or terminal actions. Its optional deletion callback supports independent rendering; the production surface always wires it to acknowledged catalog removal.
- Before opening a composer draft, selected paths pass the existing runtime scope policy. Unsupported isolated-space targets and unavailable folders retain the editor and show a localized error. Folder selection grants no permission.
- Workspace overview selection is restored from device/runtime-local storage. Explicit session or draft navigation clears that selection without changing open membership.

## Decisions

### Why Base UI owns tab interaction

Base UI Tabs provides linked tabs and panels, roving keyboard focus and locale-aware arrow navigation. The controls reuse the shared recessed pill track and raised selection styling. Kept-mounted panels preserve unsaved editor fields across tab changes.

### Why Scheduled tasks is a tab-triggered page transition

Scheduled tasks is a shared page, not an editor panel. Its real tab opens the existing page, whose initial scope comes from the workspace already selected by the editor. The tab remains selected while that page is open; closing it returns the editor to Home and leaves its unsaved draft untouched.

### Why callbacks own persistence and creation

The overview can be rendered independently of application stores and runtime initialization. Callback rejection leaves the editable data intact; only acknowledged parent props change the saved basis.

### Why unlinking writes immediately

Unlinking is an independent catalog action with its own serialized, acknowledged store operation. The overview waits for the updated workspace props before removing the folder, preserving unrelated edits in its draft when the acknowledged catalog snapshot arrives.

### Why workspace history uses one global projection

The surface derives unique session rows and their matching folder paths in one pass over global entities and their captured scopes. A local filter reuses that projection. Global loading joins the store's existing request; per-folder reads would start unnecessary OpenCode locations and miss archived conversations. Only initial idle state and explicit Retry request loading, so a failed request never creates a retry loop.

### Why pagination follows the folder filter

Local pages slice the filtered global projection into 10 rows, preserving matching, deduplication and ordering. Server pagination would add requests and split discovery ownership away from the global sessions store.

### Why the footer belongs to the navigation shell

The workspace overview and open-session list share one sidebar shell, so their actions stay mounted in one shared footer outside either scrolling view.
