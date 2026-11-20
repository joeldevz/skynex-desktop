# Design tree: Workspace commands

## Resolved decisions

- Skynex supports commands shared within a named workspace alongside commands scoped to individual folders.
- Shared commands are available in every session of that workspace, including sessions opened from a single folder.
- Shared commands use the session's primary folder as their working directory. The workspace's general chat uses its own managed chat directory.
- If the session's primary folder and its workspace define a command with the same name, the folder command takes precedence. If the folder does not define it, the workspace command is available.
- Shared commands expand `$ARGUMENTS` into plain prompt text. Expansion does not run shell commands or read files.

## Open assumptions

- None.

## Out of scope

- The scope of existing folder commands does not expand merely because the folder belongs to a workspace.

## Runtime surfaces

- Web uses the runtime's workspace catalog and the standard prompt route.
- Electron desktop uses the same catalog and prompt route through its in-process server.
- Hosted mobile uses the shared command picker and prompt route.
- Capacitor mobile uses the same picker and the connected runtime's catalog.
- VS Code keeps its directory-only Commands settings; workspace shortcuts require a Skynex workspace target.

## Ready for planning

Yes. The scope, working directory, and precedence are agreed.
