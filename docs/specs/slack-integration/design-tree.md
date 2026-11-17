# Design Tree — Slack integration (skynex-app)

Reference: the Claude "Pair your Slack workspace" screen (logo pair, step 1 "send this message in any channel", step 2 "paste the pairing code", "Pair workspace" button, #channel preview on the right).

## Resolved decisions

- D1: The agent is a Slack bot named `skynex-app` with its own profile, plus an optional user token that lets it read the user's DMs and send as the user. A bot alone cannot see the user's private conversations.
- D2: Pairing starts with `@skynex-app connect` in any channel, which returns a pairing code the user pastes into OpenChamber.
- D3: One public Slack app, `skynex-app`, distributed through "Add to Slack". Users do not create their own Slack app.
- D4: A Skynex Cloudflare Worker receives the Slack OAuth callback and the Events API traffic. At pairing it hands the tokens to the user's OpenChamber and deletes them. Afterwards it only forwards events over the instance's outbound connection (the private relay pattern in `packages/web/server/lib/relay`) and stores no messages. The instance calls the Slack Web API directly to read and send.
- D5: Acting as the user is limited by an allowlist of people and channels set in Settings. Reading inside the allowlist needs no approval. Every send as the user asks for approval in OpenChamber, like OpenCode tool permissions. Bot replies in threads where `skynex-app` was mentioned need no approval.
- D6: A mention opens one OpenCode session per Slack thread, in the project mapped to that channel. The agent posts progress in the thread, and later thread messages continue the same session. Only people the user allows can start work.
- D7: The Worker lives in `packages/slack-relay`, outside the Bun workspaces like `packages/docs`, with its own `wrangler.toml`, tests and `DOCUMENTATION.md`.
- D8: The agent reaches Slack through a new managed tool `openchamber_slack` (read, search, reply, send), following `packages/web/server/lib/agent-tool`. It is off until a workspace is paired.
- D9: The UI is a "Slack" card in Settings → Integrations → Built-in integrations, next to the source-control providers. Unpaired, it shows the reference screen with the Skynex and Slack logos. Paired, it shows the workspace, the allowlist and the channel → project map.

## Open assumptions (validate before planning)

- A1: The user registers `skynex-app` at api.slack.com, owns the Worker domain and deploys it to Cloudflare. These are external actions; the repo ships the manifest and instructions only.
- A2: Tokens are stored on the instance with the same protection as other secrets in settings. If the existing secret storage is weaker than needed for Slack user tokens, a new store is required.
- A3: Enterprise mode disables the whole integration, because message content and events travel through the Skynex Worker (`enterprise-boundary` skill).
- A4: Slack review of a publicly distributed app may restrict the user-token scopes. If it does, D1's "as the user" part ships only for workspaces that install the app unlisted.

## Out of scope (explicit)

- Slack Enterprise Grid org-wide installs.
- Other chat platforms (Discord, Telegram).
- Storing Slack message history on the Worker or on the instance beyond the session transcript.

## Ready for planning

⚠️ pending: A1 to A4 confirmed by the maintainer; then route to tech-planner. Required reviews: `enterprise-boundary`, dual security review (tokens, outbound relay, acting as the user).
