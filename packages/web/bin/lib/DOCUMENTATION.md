# CLI Module Map

This directory contains the non-entrypoint implementation for the Skynex application CLI. `packages/web/bin/cli.js` owns bootstrap, command wiring, top-level dispatch, signal/cancel handling, and compatibility exports. Domain logic belongs in these modules.

The canonical executable is `skynex-app`; `openchamber` remains a compatibility alias for existing services and Electron SSH integration. Both names dispatch through the same entrypoint. Help, completions, and command hints use `skynex-app`. Package identity, service identifiers, profiles, storage paths, and environment variables remain unchanged. New protocol URLs use only `skynex-app://`; there is no `openchamber://` alias. The separate `skynex` command manages agent tooling.

Standalone CLI distribution uses GitHub Releases in `joeldevz/skynex-desktop`. It requires Node.js 24.14+ and installed OpenCode. Each release must contain `install.sh`, `skynex-app-install.mjs`, and native `skynex-app-<version>-<platform>-<arch>.tar.gz` bundles with matching `.sha256` files. The shell installer downloads the standalone installer from the same release. Bundles include complete application dependencies and the SDK. Published 0.1.1 has no CLI assets or new scheme; the checkout changes are unpublished.

The distribution contract is an opt-in per-user managed root with a stable launcher and active-version pointer. Managed updates stage and verify SHA256 before activation, preserve the old version, and leave running instances alone. Restart is explicit. Source and unmanaged installs refuse updates before changing files or running servers. There is no npm fallback. Web UI update guidance may be manual.

## Entrypoint Boundary

- `../cli.js`
  - Owns process bootstrap, package/version lookup, command table wiring, signal handlers, top-level error handling, and legacy exports used by tests or external consumers.
  - Injects runtime dependencies into command factories, such as `serveCommand`, `stopCommand`, package-manager loading, cancel cleanup, and foreground server state setters.
  - Should not grow command-specific behavior. If a new branch needs more than dispatch/wiring, move it here into a command or helper module instead.

## Command Modules

Command modules implement user-facing commands and preserve output contracts across interactive, non-TTY, `--quiet`, and `--json` modes. They should use `../cli-output.js` for presentation helpers and keep safety validation in command logic, not prompts.

- `commands-serve.js`
   - Implements `skynex-app serve`.
  - Owns OpenCode CLI checks, port resolution, log rotation, PID/instance registry writes, foreground/background server launch, startup summaries, and foreground shutdown behavior.

- `commands-lifecycle.js`
   - Implements `skynex-app stop` and `skynex-app restart`.
  - Owns lifecycle stop/restart semantics, desktop-managed port rejection, unmanaged instance shutdown attempts, PID/instance cleanup, and restart reuse of stored instance options.

- `commands-status.js`
   - Implements `skynex-app status`.
  - Formats discovered instances and tunnel readiness/status for human, quiet, and JSON output.

- `commands-session.js`
   - Implements `skynex-app session create`, `send`, `fork`, `list`, `status`, and `messages`.
  - Maps CLI options to shared control-service inputs and owns only human, quiet, and JSON presentation.
  - Message projection matches Export Markdown semantics: only ordered `text` parts are exposed; tool, reasoning, file, and other parts are omitted.
  - The server control service owns create/worktree/prompt orchestration, official OpenCode reads, Goal Mode, wait semantics, and partial failures.

- `commands-schedule.js`
  - Implements scheduled task status/list/create/run/delete/enable/disable.
  - Maps options to control-service inputs and renders results; project resolution, validation, persistence, and execution remain server-owned.

- `commands-models.js`
  - Prints OpenChamber default, favorite, and recent model settings.

- `commands-projects.js`
  - Prints configured project labels, ids, and directories for later control-plane calls.

- `commands-logs.js`
   - Implements `skynex-app logs`.
  - Resolves log files, tails recent lines, and follows log output.

- `commands-startup.js`
   - Implements `skynex-app startup`.
  - Handles startup subcommand dispatch and presentation around the lower-level startup service helpers.

- `commands-connect-url.js`
   - Implements `skynex-app connect-url`.
  - Finds or starts a local instance and prints the browser/connect URL according to the selected output mode.
   - Emits a **pairing v2** link (`skynex-app://connect?v=2&p=<base64url>`). It creates a one-time pairing session in the shared store (`client-pairing-sessions.json`) and encodes the pairing id, secret, and transport candidates. The client redeems the secret over whichever candidate connects first (`/api/client-auth/pairing/redeem`). The QR itself is the single-use credential.
  - The default form advertises the resolved server URL as a direct (lan/tunnel) candidate and folds in a relay candidate when the host relay is enabled, so one link works on-LAN and off-network.
  - `--relay` builds a relay-only pairing link (the sole candidate is the relay transport), for sharing with a device that is not on the host's network — no server URL, no auto-start. The relay endpoint follows the administrator's pin (`pinnedRelayUrl`: policy file, then `OPENCHAMBER_RELAY_URL`) / the stored setting / the default, matching the running host; the host must be running with the relay enabled to serve the redeem over the tunnel.

- `commands-update.js`
   - Implements `skynex-app update` for managed release installations.
   - Stages the release bundle, verifies SHA256, and activates it while preserving the previous version.
   - Leaves running instances untouched. Users restart explicitly. Source and unmanaged installations fail without modifying files or stopping servers; no package-manager fallback is allowed.

- `commands-tunnel.js`
   - Implements `skynex-app tunnel` and its subcommands: `profile`, `providers`, `ready`, `doctor`, `status`, `start`, `stop`, and `completion`.
  - Owns tunnel-specific command flow, interactive prompt decisions, managed-local/managed-remote startup, QR display rules, tunnel start/stop API calls, and tunnel profile command handling.
  - Receives `serveCommand` and `stopCommand` by dependency injection. Do not reach back into `cli.js` command globals from this module.

## Shared Helper Modules

These modules hold reusable, non-presentational logic for commands.

- `cli-args.js`
  - Argument parsing, defaults, help text, completion script generation, and typo suggestions.
  - `COMMAND_OWNED_FLAGS` lists flags only one family of commands reads (schedule, session, tunnel, logs). Such a flag on any other command is an `Unknown option for <command>` error in every output mode instead of being ignored; global and shared flags are not listed and stay accepted everywhere. Add a new command-specific flag there.

- `cli-errors.js`
  - CLI exit codes and typed tunnel CLI errors.

- `cli-paths.js`
  - Data, run, log, settings, tunnel profile, and managed-local config paths.

- `cli-settings-accessors.js`
  - Minimal settings.json read/write for CLI contexts that must not load the
    full web settings runtime (`connect-url` relay identity resolution).
  - Mirrors the settings runtime's guarantees so a CLI read-modify-write can
    never corrupt shared state: atomic tmp+rename writes (no concurrent reader
    in the running app can observe a torn file), a strict read that throws on
    corrupt/unreadable payloads, and the same `0600` file mode.
  - The strict read gates relay identity regeneration exactly like the server
    runtime (`server/lib/relay/key-store.js`, which may still find legacy keys
    in settings.json): a swallowed read failure can never mint a replacement
    signing or encryption keypair, which would change `serverId` and orphan
    every paired device and push binding.

- `cli-process.js`
  - PID files, instance registry files, process identity checks, runtime metadata checks, and process termination helpers.

- `cli-lifecycle.js`
  - Instance discovery, live health probing, attachability checks, provider discovery, and status aggregation used by lifecycle/status/tunnel commands.

- `cli-http.js`
  - HTTP helpers for health checks, shutdown requests, JSON API calls, tunnel provider fetches, and system info fetches.
  - Owns local desktop bearer auth and managed CLI-instance UI password retry for control-plane requests.

- `cli-control.js`
  - Sends one typed action request to the authenticated OpenChamber control endpoint and maps HTTP failures to CLI exit behavior.
  - Must not reproduce session, scheduled-task, project-resolution, or wait orchestration.

- `cli-api-target.js`
  - Resolves the target OpenChamber runtime for control-plane commands, preferring desktop unless a port is explicit.

- `cli-goal.js`
  - Owns shared Goal Mode token-budget validation for session and schedule commands.

- `cli-network.js`
  - Host resolution, URL building, LAN detection, unsafe browser port validation, and UI password/network exposure checks.

- `cli-ports.js`
  - Port availability checks and available-port resolution.

- `cli-log-files.js`
  - Log rotation, tail reads, and file-follow streaming.

- `cli-executables.js`
  - Executable path resolution and PATH lookup helpers.

- `cli-startup.js`
  - Native startup service detection, install/uninstall/status helpers, and platform-specific startup command execution.
  - The service runs the CLI by its resolved path. A pnpm global install resolves into a versioned `.pnpm` store directory that an update leaves behind, so the entrypoint is mapped back to the stable `node_modules/@openchamber/web` link when it exists.
  - Managed Skynex installs register the install-root `launcher.mjs`, which reads `active.json` on every launch. It must be an owned regular file; if it is missing or modified, `startup enable` fails with installer repair guidance rather than registering the physical release entrypoint.
  - The macOS LaunchAgent leaves `ProcessType` unset so launchd does not force the managed OpenCode child into background-tier scheduling. Re-running `startup enable` replaces an existing plist.
  - The environment snapshot drops the variables a running OpenChamber put into the enabling shell, read from the `OPENCHAMBER_INJECTED_ENV` record (`server/lib/injected-env.js`), so a service enabled from the desktop app's terminal or an agent's shell does not inherit that instance's runtime flags, UI password, or managed OpenCode password (#4604). The user's own exports, `OPENCODE_HOST` included, still carry over. `cli-args.js` applies the same record to the `OPENCHAMBER_UI_PASSWORD` default.

- `cli-tunnel-profiles.js`
  - Tunnel profile normalization, token resolution/redaction, profile storage, migration, file-permission warnings, and managed-remote pair persistence.

- `cli-tunnel-utils.js`
  - Tunnel-specific command string builders, TTL parsing/formatting, and replay command helpers.

- `cli-tunnel-capabilities.js`
  - Built-in tunnel provider capability fallbacks used when a live server cannot provide tunnel metadata.

## Placement Rules

- Add new CLI commands as `commands-*.js` modules and wire them from `cli.js`.
- Add reusable logic to the narrow helper module that owns the domain. Create a new helper module before mixing unrelated domains into an existing one.
- Keep command modules responsible for user-visible behavior and mode-specific output. Keep helper modules mostly output-free unless the helper exists specifically for CLI rendering.
- Preserve output contracts when moving code:
  - `--json` emits JSON only.
  - `--quiet` emits concise essential output.
  - Prompts are gated by `canPrompt(options)`.
  - Validation and policy run in every mode.
- Prefer dependency injection from `cli.js` for cross-command behavior, especially when one command needs another command's implementation.
- Do not import `cli.js` from modules in this directory. The dependency direction is `cli.js` -> command modules -> helper modules.

## Verification

For CLI behavior changes, run the focused CLI suite from `packages/web`:

```sh
bun run test -- bin/cli.test.js
```

Before finalizing source changes that affect CLI behavior, also run:

```sh
bun run type-check
bun run lint
```
