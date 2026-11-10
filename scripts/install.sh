#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="joeldevz/skynex-desktop"
MIN_NODE_MAJOR=24
MIN_NODE_MINOR=14
VERSION=""

while (($#)); do
  case "$1" in
    --version)
      if [[ -n "$VERSION" || $# -lt 2 ]]; then
        echo "Usage: install.sh [--version <semver>]" >&2
        exit 2
      fi
      VERSION="$2"
      shift 2
      ;;
    *)
      echo "Usage: install.sh [--version <semver>]" >&2
      exit 2
      ;;
  esac
done

if [[ -n "$VERSION" && ! "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)([-+][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid release version: $VERSION" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24.14 or newer is required." >&2
  exit 1
fi
NODE_VERSION="$(node -p 'process.versions.node')"
IFS=. read -r NODE_MAJOR NODE_MINOR _ <<< "$NODE_VERSION"
if (( NODE_MAJOR < MIN_NODE_MAJOR || (NODE_MAJOR == MIN_NODE_MAJOR && NODE_MINOR < MIN_NODE_MINOR) )); then
  echo "Node.js 24.14 or newer is required. Found $NODE_VERSION." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download the Skynex installer." >&2
  exit 1
fi

if [[ -n "$VERSION" ]]; then
  ASSET_URL="https://github.com/$REPOSITORY/releases/download/v$VERSION/skynex-app-install.mjs"
else
  ASSET_URL="https://github.com/$REPOSITORY/releases/latest/download/skynex-app-install.mjs"
fi
INSTALLER="$(mktemp "${TMPDIR:-/tmp}/skynex-app-install.XXXXXX.mjs")"
trap 'rm -f "$INSTALLER"' EXIT
curl --fail --location --silent --show-error "$ASSET_URL" --output "$INSTALLER"
if [[ -n "$VERSION" ]]; then
  node "$INSTALLER" --version "$VERSION"
else
  node "$INSTALLER"
fi
