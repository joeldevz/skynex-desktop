# Workspace chat directories

## Ownership

This module resolves the managed directory used by workspace-wide general chats. The caller supplies the existing managed Chats root and trusted linked paths. Workspace catalog membership, authentication, and HTTP behavior belong to the route layer.

## Invariants

- A workspace ID maps deterministically to one child path under the managed Chats root.
- Workspace IDs never become path segments. The child name is a SHA-256 digest.
- The root and every path component must be a real directory, with no symlinks, and the target's canonical identity must remain directly beneath the canonical root.
- The resolver creates only the validated target directory, with mode `0700`; it does not recursively create or delete paths.

The resolver checks candidate directories against canonical linked repository paths before creating them. If a linked path cannot be canonicalized, resolution fails without creating the workspace directory. Existing directory permissions remain unchanged. The reserved direct-child name is `workspace-<sha256>`; the filesystem delete route protects that directory and its descendants, plus any ancestor containing a managed Chats root, from ordinary scratch cleanup. It checks real directory identity so filesystem aliases cannot bypass the guard, and keeps leaf symlink deletion scoped to the symlink itself.

## Decisions

### Why hash workspace IDs

Workspace IDs are data and may contain path syntax. Hashing gives them stable filesystem-safe names without disclosing the ID in the path.

### Why validate path components before creation

Recursive directory creation could follow an untrusted intermediate symlink. The resolver validates the existing Chats root first, then creates only one direct child and verifies its canonical location.

### Why require canonical linked paths before creating the directory

The managed Chats root can be configured inside a linked repository. Checking the hashed target against canonical linked paths prevents directory creation from changing that repository. A missing linked path has no established filesystem identity, so the resolver fails closed.

### Why preserve existing directory permissions

An existing managed chat directory may contain user data with deliberate permissions. The resolver sets private permissions when it creates the directory and leaves existing directories unchanged.

### Why reserve workspace chat directory names

Workspace conversations share a stable managed directory across chats. The filesystem delete route protects that reserved directory and its descendants, and any ancestor of an applicable managed Chats root, while ordinary scratch folders keep the existing delete behavior.

### Why check canonical directory identity before cleanup

An alias can name a protected workspace chat directory outside its lexical path. The delete route resolves real directories before applying the cleanup guard, while leaf symlinks remain lexical so recursive removal unlinks the link rather than following its destination.
