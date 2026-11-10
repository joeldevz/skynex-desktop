# Standalone CLI release updater

## Ownership

`../skynex-app-updater.js` owns GitHub release metadata validation, bounded archive verification, and activation of a per-user standalone `skynex-app` install. The CLI bootstrap and packaging scripts own the stable launcher and installer entrypoints.

## Invariants

- Release requests target only `joeldevz/skynex-desktop`; archive and checksum asset URLs must match the version, platform, architecture, and canonical filename exactly.
- `getLatestSkynexAppRelease({ version? })` returns `{ version, archiveName, archiveUrl, checksumUrl, sha256 }`. Passing a validated exact `version` reads its `v<version>` tag, allowing bootstrap installers to pin the release selected by metadata.
- `installSkynexAppRelease({ release, installRoot, fetchImpl?, limits?, onPhase? })` verifies SHA-256, gzip and ustar contents, release metadata, package version, and the staged CLI's `--version` output before it changes the active pointer.
- Install roots are owned by `{ format: 1, application: "skynex-app" }` in `managed.json`. Updates require that marker and a valid `active.json`; an empty root receives ownership files only after install success.
- Install failures preserve the existing pointer and installed versions, clean temporary files and the exclusive lock, and leave unrelated files untouched.
- `isManagedSkynexAppInstall()` derives ownership from this module's physical release layout, marker, and active pointer. Source checkouts and package-manager installs return false.
- The compatibility update check advertises standalone CLI releases for web servers. Capacitor app checks remain unavailable because these release assets are not APKs; VS Code checks continue through its extension-host updater.
- The helper has no runtime package dependencies. Its public exports are `getLatestSkynexAppRelease`, `installSkynexAppRelease`, and `isManagedSkynexAppInstall`.

## Decisions

### Why a versioned directory and pointer

Each verified release remains in `versions/<version>/skynex-app`; `active.json` switches the stable launcher to it atomically. The previous release stays available, and running servers continue with their loaded code until the operator restarts them.

### Why only canonical GitHub assets

Release metadata is external input. Exact URLs and SHA-256 checks prevent a release record from redirecting installation to a different project or host. Download redirects are limited to GitHub's release asset CDN hosts.
