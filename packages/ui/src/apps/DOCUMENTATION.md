# VS Code application roots

## Ownership

`VSCodeApp` composes the shared runtime, theme and sync contexts for VS Code webviews. The extension host selects the root's `panelType` in its bootstrap document. `VSCodeLayout` owns chat/session navigation; `SettingsView` owns Settings pages and responsive navigation. The native panel lifecycle belongs to `packages/vscode/src`, documented there.

## Invariants

- Native links use only `skynex-app://`. Pairing encoding belongs to `lib/connectionPayload.ts`; session/message link generation and markdown recognition belong to `lib/sessionLinks.ts`. Generic external-app opening blocks both `skynex-app://` and the rejected legacy `openchamber://`, so pairing and session navigation keep their own confirmation and validation paths. `openchamber-ui://` remains the desktop's internal storage origin.

- `MobileApp` owns mobile app-level surfaces such as scheduled tasks. Shared surfaces use `MobileAppActions` to request those pages so they appear above mobile drawers; workspace selection remains in the shared store for scheduler preselection.
- `MobileSessionsSheet` owns the phone drawer and iPad sidebar shell. Opening it hydrates explicit open-session membership through the shared serialized store; failures retain existing rows and use its retry path. Selecting a session closes the phone drawer only after the shared navigation accepts the row. Its header keeps Close and New chat on one row. Its footer owns Settings and More; secondary pages and help actions stay in More. Selecting a More item closes the sheet before opening its host surface. Mobile mounts `HelpDialog`; About opens the Settings About page. The workspace overview remains in `SessionSidebar`. `SessionDialogs` owns the shared New worktree dialog. Sheet open/close and edge-swipe behavior stay here.
- Chat-side Settings entry points request the native Settings tab through `RuntimeAPIs.vscode`. They preserve chat selection, drafts and the current layout. The source's in-page dialog flag is cleared so it cannot block chat shortcuts.
- Only the Settings root receives page navigation. The bridge parses it before applying it to stores, and the mounted root signals readiness before the host consumes pending navigation.
- The Settings root supplies no selected directory to the shared sync provider. It does not start global session polling, selected-directory session bootstrap or background queue delivery/cleanup, and seeing it never marks a chat as viewed. Settings pages resolve their own project through `useSettingsDirectory`; catalog updates still use the shared sync context.
- Its runtime shortcut hook registers Settings actions only and requires no chat sync context. Chat, model and session shortcuts remain with chat roots, so a key pressed in Settings cannot create an unseen draft or change a session selection there. Escape reaches an input or menu before the tab's close handler.
- Settings uses the existing persistence and broadcast protocol. Moving its host changes no stored format, registry key or runtime availability.

## Decisions

### Why navigation carries intent and not the source's stores

Each webview owns its own stores. A small parsed request preserves the originating Settings directory, page links, provider-connect action and new-snippet action without transferring chat state or overwriting the tab's independently edited settings.
