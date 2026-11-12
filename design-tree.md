# Design Tree: Workspaces and open sessions

## Resolved decisions

- D1: A workspace is a named, user-managed group of existing project folders. Folders may live in different locations and may have no Git repository.
- D2: The sidebar shows workspaces above a global list of open agent sessions. The global list includes sessions from every workspace.
- D3: Selecting a workspace opens its project overview while preserving the global session list. The overview provides its description, member folders, quick configuration, access to its open sessions, and session creation actions.
- D4: The workspace description and each folder's role are editable documentation. An agent changes that documentation only when explicitly asked.
- D5: Workspace quick configuration includes its name, description, folder membership, and default model and agent. A session can override the model and agent defaults when created.
- D6: A session belongs to a workspace and can work with one or several of its folders. Session entries identify their workspace and folder scope so the global list remains understandable.
- D7: Creating a session from the workspace initially selects all its folders. Creating one from a folder initially selects that folder. The selection is editable before creation.
- D8: Creating a session or explicitly reopening one adds it to the open-session list. Historical sessions never appear automatically.
- D9: Open sessions persist across application restarts. Completing a response or switching workspaces leaves a session open.
- D10: A session closes only on the user's explicit command. Closing removes it from the open list and preserves its conversation in history, where it can be reopened.
- D11: Closing a session with an agent still working asks for confirmation to stop the agent and close. Cancelling leaves it open and working.
- D12: On the first transition to this model, retain only the currently viewed session as open. Other existing sessions stay in history until explicitly reopened. Subsequent restarts restore the explicit open-session list.
- D13: Removing a folder from a workspace preserves its files and existing open sessions. Those sessions retain access to that folder until the user closes them. Removal changes the workspace's selection for future sessions.
- D14: Workspace and open-session lists scroll independently within the sidebar. Eye controls temporarily hide a workspace's sessions or all open sessions from the sidebar; hiding never changes open membership and resets when the navigation component is recreated.

## Open assumptions to validate before implementation

- A1: The existing session runtime may bind execution to one working directory. Planning must establish how a session can access its selected folders across every supported runtime without claiming unsupported multi-folder execution.
- A2: Workspace metadata, explicit open-session membership, and migration need an owning persistence contract. Their storage and device/runtime synchronization are technical decisions to validate against the current repository.
- A3: Exact visual styling and controls remain to be designed using the application's UI conventions. The supplied Herdr image establishes the workspace-above, sessions-below organization.

## Out of scope

- Shell terminals, terminal tabs, and terminal lifecycle.
- Creating folders, initializing Git repositories, or creating remote repositories.
- Deleting a whole workspace. Its effects on existing sessions need a separate product decision if that action is introduced.
- Automatically rewriting workspace documentation.
- Automatically reopening historical sessions or closing idle sessions.
- Changes to unrelated workspace and session behavior, dependency installation, and external release operations.

## Ready for planning

Yes. The interaction model is agreed. Technical assumptions A1 and A2 belong to planning; runtime limitations that change the agreed behavior must return for a product decision. D14 adds transient sidebar visibility controls while preserving the open-session membership contract.
