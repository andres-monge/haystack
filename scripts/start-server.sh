#!/bin/bash
# Wrapper for launchd to start the Haystack Express server.
# launchd runs in a minimal environment — this script ensures
# Node.js is on PATH and the working directory is correct.

set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

# Resolve a runtime that satisfies package.json's Node >=20 requirement.
# nvm directories sort lexicographically, so the first installed version may
# be an unsupported v18 even when a compatible newer runtime is also present.
MIN_NODE_MAJOR=20
NODE_DIR=""
if [ -n "${HAYSTACK_NODE_SEARCH_DIRS:-}" ]; then
  IFS=: read -r -a NODE_CANDIDATE_DIRS <<< "$HAYSTACK_NODE_SEARCH_DIRS"
else
  NODE_CANDIDATE_DIRS=(
    "$HOME/.nvm/versions/node"/*/bin
    "$HOME/.volta/bin"
    "/opt/homebrew/bin"
    "/usr/local/bin"
  )
fi

for dir in "${NODE_CANDIDATE_DIRS[@]}"; do
  if [ ! -x "$dir/node" ]; then
    continue
  fi

  version="$("$dir/node" -p 'process.versions.node' 2>/dev/null || true)"
  major="${version%%.*}"
  if [[ "$major" =~ ^[0-9]+$ ]] && [ "$major" -ge "$MIN_NODE_MAJOR" ]; then
    NODE_DIR="$dir"
    break
  fi
done

if [ -z "$NODE_DIR" ]; then
  echo "ERROR: Node.js >=${MIN_NODE_MAJOR} is required. Install a supported runtime or update this script." >&2
  exit 1
fi
export PATH="$NODE_DIR:$PATH"

# Ensure output + log directories exist
mkdir -p "$HOME/.haystack"

echo "[$(date -u +%FT%TZ)] Starting Haystack server (node v${version})"
exec npx tsx src/server/start.ts
