# Workspace general chat

## Resolved decisions

- **D1.** New conversation from the workspace opens a general chat without asking for a folder. An empty workspace offers Add folder.
- **D2.** General chats belong to the workspace and appear in its history. OpenCode uses a stable, app-managed directory per workspace, outside the linked repositories. Renaming the workspace or reordering its folders does not change the directory.
- **D3.** The agent receives the linked folders' real paths and roles through the workspace manifest. No folder is primary, no symbolic links are required, and existing permissions still apply.
- **D4.** Chats opened from a specific folder use that repository's working directory and configuration. Existing chats keep their original location and scope when reopened.
- **D5.** If the workspace's saved agent is unavailable in the neutral context, the draft uses OpenCode's default agent for that context. Before sending, the composer names the agent it will use, explains the fallback, and offers Change agent. This does not change workspace defaults or select a repository.
- **D6.** If the runtime cannot open a neutral chat, show the reason and offer an explicit folder chat. Never silently use the first folder.

## Assumptions to verify during planning

- Confirm that supported runtimes can open and reopen the managed directory without inheriting linked repository configuration. Identify runtimes that need the unsupported-state behavior.
- Verify that the existing manifest and permission flow support work in two linked repositories while using a neutral directory.
- Verify compatibility with stored workspace scopes, history, and open-session references.

## Out of scope

- Moving existing conversations or changing their scope.
- Creating symbolic links, copying repositories, merging repository configuration, or granting filesystem access.

## Ready for planning

Yes. The product decisions are settled. Runtime support and compatibility still need verification.
