# Skynex

[![GitHub release](https://img.shields.io/github/v/release/joeldevz/skynex-desktop?style=flat&labelColor=100F0F&color=205EA6)](https://github.com/joeldevz/skynex-desktop/releases/latest)

Skynex is a fork of [OpenChamber](https://github.com/openchamber/openchamber). Upstream credits and the MIT license are preserved.

## Run agent work. Keep control. Ship from anywhere.

Skynex is an open-source workspace for running and reviewing AI coding work on desktop, web, VS Code, and mobile.

Start agent work, see what changed, and take it through review and release. Your projects and sessions remain available when you switch devices or step away.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/references/desktop_dark.png"><img src="docs/references/desktop_light.png" alt="OpenChamber desktop app"></picture>

<details>
<summary>More screenshots</summary>

![VS Code Extension](packages/vscode/extension.jpg)

<p>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/references/mobile/new_session_dark.png"><img src="docs/references/mobile/new_session_light.png" width="30%" alt="OpenChamber mobile new session"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/references/mobile/chat_dark.png"><img src="docs/references/mobile/chat_light.png" width="30%" alt="OpenChamber mobile chat"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/references/mobile/context_usage_dark.png"><img src="docs/references/mobile/context_usage_light.png" width="30%" alt="OpenChamber mobile context and usage"></picture>
</p>

</details>

## What you can do with Skynex

### Goals that continue on their own

Give a session a finish line with **Session Goals**. Skynex checks the result after every turn and keeps the agent working until it completes the goal, gets blocked, or reaches the limit you set. It can continue after you close the app.

### Compare and combine runs

Use **Multi-run** to give the same task to up to five models, each in its own session and optionally its own worktree. See what each one actually built, choose the best result, or use **Fusion** to combine the strongest parts into a new session.

### Guided changes walkthroughs

**Changes Walkthrough** turns a large diff into an AI-guided tour of the change. It groups related edits into steps, puts them in the order the change makes sense, and explains how the pieces fit together.

### Inspect a running app

Open your app beside the conversation with **Preview**. Point at an element to send the agent its screenshot, styles, position, and browser errors. No more trying to explain "this thing here." The desktop app can do the same with any web page in its built-in browser.

### GitHub context from issue to pull request

Start a session from a GitHub issue or pull request with its context attached. Send failed checks or review comments back to the agent, then update or merge the pull request from Skynex.

### Continue on another device

Open the same projects and sessions from Desktop, Web/PWA, VS Code, iOS, or Android. Check progress, answer questions, review changes, and reattach to a running terminal.

### Private remote access

Pair a device with a one-time QR code and connect through **Private Relay** without opening ports or exposing a public server. The connection is end-to-end encrypted and can be revoked at any time. Direct connections, LAN/VPN access, Cloudflare/Ngrok tunnels, and SSH are also supported.

### Track work across projects

See which sessions are working, waiting, finished, or failed, along with approvals, scheduled tasks, provider limits, token use, and costs. Organize sessions into folders and keep notes, todos, and reusable project actions nearby.

### Schedule recurring work

Run a prompt once, daily, weekly, or on a cron schedule. Scheduled tasks can use Session Goals, so they continue toward an outcome instead of stopping after one response.

## Use it where you work

| Surface | Role |
| --- | --- |
| **Desktop** | The complete workspace for macOS, Windows, and Linux, with multiple windows, Mini Chat, remote machines, SSH, and native notifications |
| **Web / PWA** | Open your workspace in a browser, install it as an app, and stay up to date through background notifications |
| **VS Code** | Keep sessions beside your code, send selections to the agent, open results in the editor, and compare parallel runs |
| **iOS / Android** | Review and steer work away from your desk, receive completion alerts, and use the terminal with touch controls |
| **CLI / Server** | Run Skynex on a workstation or server, schedule work, manage remote access, and keep it available after login |

## Quick start

### Desktop for macOS, Windows, and Linux

Download an available build from [Skynex GitHub Releases](https://github.com/joeldevz/skynex-desktop/releases/latest). Desktop bundles the matching OpenCode CLI, so no separate OpenCode installation is required. Available platforms are listed with each release.

Linux releases come for x86_64 and ARM64 as a `.deb` (Debian, Ubuntu), an `.rpm` (Fedora, openSUSE) and an AppImage. The packages install Skynex into the app menu, and in-app updates ask for your password to install the new package:

```bash
sudo apt install ./Skynex-*-linux-amd64.deb    # Debian, Ubuntu
sudo dnf install ./Skynex-*-linux-x86_64.rpm   # Fedora
```

The AppImage needs no install. Make it executable and keep it in a writable location for in-app updates; on its first start it adds itself to the app menu:

```bash
chmod +x Skynex-*.AppImage
./Skynex-*.AppImage
```

Linux AppImages require FUSE (`libfuse.so.2`). Without FUSE, run with `APPIMAGE_EXTRACT_AND_RUN=1`.

### VS Code

The [OpenChamber extension](https://marketplace.visualstudio.com/items?itemName=fedaykindev.openchamber) is maintained by upstream. Skynex does not publish to that listing.

### CLI for Web and PWA

Requires Node.js 24.14+ and an installed [OpenCode CLI](https://opencode.ai). The application command is `skynex-app`. The separate `skynex` command manages agent tooling. The `openchamber` executable remains available for existing SSH integrations and services.

The release installer requires a Skynex release containing CLI assets. Published version 0.1.1 has no CLI assets or `skynex-app://` links. The changes in this checkout are not published. Use this command only after a release includes `install.sh`, `skynex-app-install.mjs`, and the bundle for your platform:

```bash
curl -fsSL https://github.com/joeldevz/skynex-desktop/releases/latest/download/install.sh | bash
skynex-app --ui-password be-creative-here
```

Common operations:

```bash
skynex-app status
skynex-app connect-url --qr
skynex-app tunnel start --provider cloudflare --mode quick --qr
skynex-app startup enable
skynex-app logs
skynex-app stop
skynex-app update
```

The installer offers a per-user managed installation with a stable launcher. It downloads the standalone installer and native bundle from the same GitHub release. Bundles include application dependencies and the SDK.

Managed updates verify SHA256 before activating the staged version and preserve the previous version. Running servers keep running until you explicitly run `skynex-app restart`. Source and unmanaged installations refuse `update` without changing files or running servers. There is no npm fallback. Web users may need to run the update command manually.

New connection links use `skynex-app://`. Old `openchamber://` links are not accepted. Existing profiles, storage paths, and environment variables keep their technical names.

Skynex binds to localhost by default. Use `--lan` only on a trusted network and protect browser access with `--ui-password`.

## Guides

Use the repository guides. Pages outside installation and quickstart may still describe upstream OpenChamber:

- [Quick start](packages/docs/content/docs/quickstart.mdx)
- [Installation](packages/docs/content/docs/install.mdx)
- [Connect devices](packages/docs/content/docs/connect-devices.mdx)
- [Private Relay](packages/docs/content/docs/private-relay.mdx)
- [Multi-run](packages/docs/content/docs/multi-run.mdx)
- [Session Goals](packages/docs/content/docs/session-goals.mdx)
- [Changes Walkthrough](packages/docs/content/docs/walkthrough.mdx)
- [Preview and dev servers](packages/docs/content/docs/preview.mdx)
- [GitHub workflows](packages/docs/content/docs/github.mdx)
- [Mobile](packages/docs/content/docs/mobile.mdx)
- [Security](packages/docs/content/docs/security.mdx)
- [Troubleshooting](packages/docs/content/docs/troubleshooting.mdx)

For self-hosting details, see the [reverse proxy guide](docs/REVERSE_PROXY.md). For custom theme authoring, see the [custom themes guide](docs/CUSTOM_THEMES.md).

## Why OpenCode?

Skynex uses [OpenCode](https://opencode.ai) to run coding agents.

Skynex handles the rest of the workflow. You can decide what to try, keep the agent on track, review the result, connect from another device, and ship the change.

Skynex is an independent project and is not affiliated with the OpenCode team.

## Contributing

Bug fixes and small improvements are welcome as PRs. Features and behavior changes start in an [Ideas discussion](https://github.com/openchamber/openchamber/discussions/categories/ideas) so we agree on the product side before anyone writes code. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR; it has the setup, the review contract, and what happens to large unplanned PRs. Documentation authoring guidance lives in [`packages/docs`](packages/docs/README.md).

Bugs and questions about Skynex go to [Skynex issues](https://github.com/joeldevz/skynex-desktop/issues).

## Acknowledgments

Special thanks to:

- [OpenChamber](https://github.com/openchamber/openchamber) and its contributors for the original application
- [OpenCode](https://opencode.ai) for the API and open-source architecture OpenChamber builds on
- [Pierre](https://pierrejs-docs.vercel.app/) for the diff viewer and syntax highlighting
- The [T3 Code](https://github.com/pingdotgg/t3code) team for their browser adapter for [libghostty-vt](https://github.com/ghostty-org/ghostty), which our terminal is built on
- [Yulia Ivashko](https://github.com/yulia-ivashko), who built the firework celebration that plays on every successful push
- Everyone who contributed code, reported bugs, or shared ideas

## License

MIT
