# Standalone application distribution

## Ownership

`package-cli-runtime.mjs` copies the native application dependency closure. `skynex-app-install.mjs` coordinates application activation with the server's standalone updater. Skynex CLI and Neurox remain separately managed tools and are outside application packaging and installation.

## Invariants

- Packaging copies only application dependencies and assets. Skynex CLI and Neurox are not packaged.
- Installation creates only the application launchers and managed application files. It does not read or modify OpenCode configuration, tool launchers, agents, permissions, MCP servers, locks, or memory data.
- Installer paths reject symlinks, and installation refuses to replace unowned files. Failed activation restores the prior managed application state and app launchers.
- Installer tests use explicit temporary environments and never mutate shared `process.env`.

## Decisions

### Why companion tools stay separate

Skynex CLI and Neurox have their own installation and update workflows. Application installation leaves their files, configuration, and data under user control.

### Why rollback stays within the application install

The standalone installer owns the managed application directory and its launchers. Restoring broader user directories could overwrite unrelated tools or data, so rollback touches only application files it owns.
