#!/bin/bash
# Wrapper for launchd to start the Haystack Express server.
# launchd runs in a minimal environment — this script ensures
# Node.js is on PATH and the working directory is correct.

set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

# Resolve Node.js: try nvm, volta, homebrew, system
for dir in "$HOME/.nvm/versions/node"/*/bin "$HOME/.volta/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
  if [ -d "$dir" ] && [ -x "$dir/node" ]; then
    export PATH="$dir:$PATH"
    break
  fi
done

if ! command -v node &>/dev/null; then
  echo "ERROR: node not found in PATH. Install Node.js or update this script." >&2
  exit 1
fi

# Ensure output + log directories exist
mkdir -p "$HOME/.haystack"

echo "[$(date -u +%FT%TZ)] Starting Haystack server (node $(node -v))"
exec npx tsx src/server/start.ts
