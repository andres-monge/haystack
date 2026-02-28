#!/bin/bash
# Install Haystack launchd agents.
# Copies plist templates to ~/Library/LaunchAgents/ with paths resolved,
# then loads them via launchctl.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DIR="$HOME/Library/LaunchAgents"

echo "Installing Haystack launchd agents..."
echo "  Project: $PROJECT_DIR"

# Ensure directories exist
mkdir -p "$HOME/.haystack"
mkdir -p "$PLIST_DIR"

# Check prerequisites
if [ ! -f "$PROJECT_DIR/scripts/start-server.sh" ]; then
  echo "ERROR: scripts/start-server.sh not found" >&2
  exit 1
fi
chmod +x "$PROJECT_DIR/scripts/start-server.sh"

# Unload existing agents (ignore errors if not loaded)
for label in com.haystack.server com.haystack.hourly; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
done

# Process and install plist templates
for plist in com.haystack.server.plist com.haystack.hourly.plist; do
  sed -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
      -e "s|__HOME__|$HOME|g" \
      "$PROJECT_DIR/launchd/$plist" \
      > "$PLIST_DIR/$plist"
  launchctl bootstrap "gui/$(id -u)" "$PLIST_DIR/$plist"
  echo "  Loaded: $plist"
done

# Log rotation (optional, requires sudo)
if [ -w /etc/newsyslog.d ] || sudo -n true 2>/dev/null; then
  sed "s|__USER__|$(whoami)|g" "$PROJECT_DIR/launchd/haystack.newsyslog.conf" \
    | sudo tee /etc/newsyslog.d/haystack.conf >/dev/null
  echo "  Installed: log rotation (weekly, 4 archives)"
else
  echo "  Skipped: log rotation (run with sudo to enable)"
fi

echo ""
echo "Done! Haystack agents installed."
echo "  Server daemon: com.haystack.server (auto-starts, KeepAlive)"
echo "  Hourly trigger: com.haystack.hourly (fires at HH:05)"
echo ""
echo "Useful commands:"
echo "  launchctl list | grep haystack       # check status"
echo "  tail -f ~/.haystack/launchd-server.log  # server logs"
echo "  tail -f ~/.haystack/launchd-hourly.log  # hourly trigger logs"
