#!/bin/bash
# Install Haystack launchd agents.
# Copies plist templates to ~/Library/LaunchAgents/ with paths resolved,
# then loads them via launchctl.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLISTS=(com.haystack.server.plist com.haystack.hourly.plist)
RENDER_DIR=""
INSTALL_TEMP_FILE=""

cleanup() {
  if [ -n "$INSTALL_TEMP_FILE" ]; then
    rm -f "$INSTALL_TEMP_FILE"
  fi
  if [ -n "$RENDER_DIR" ] && [ -d "$RENDER_DIR" ]; then
    rm -rf "$RENDER_DIR"
  fi
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM

echo "Installing Haystack launchd agents..."
echo "  Project: $PROJECT_DIR"

# Check prerequisites
if [ ! -f "$PROJECT_DIR/scripts/start-server.sh" ]; then
  echo "ERROR: scripts/start-server.sh not found" >&2
  exit 1
fi

# Render every template away from the installed location. Nothing under
# ~/Library/LaunchAgents and no loaded job is touched until both rendered
# plists have passed structural and scheduler-safety validation.
RENDER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/haystack-launchd.XXXXXX")"
for plist in "${PLISTS[@]}"; do
  if [ ! -f "$PROJECT_DIR/launchd/$plist" ]; then
    echo "ERROR: launchd/$plist not found" >&2
    exit 1
  fi
  sed -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
      -e "s|__HOME__|$HOME|g" \
      "$PROJECT_DIR/launchd/$plist" \
      > "$RENDER_DIR/$plist"
  plutil -lint "$RENDER_DIR/$plist"
done

RENDERED_HOURLY_PLIST="$RENDER_DIR/com.haystack.hourly.plist"
if ! grep -A1 '<string>--max-time</string>' "$RENDERED_HOURLY_PLIST" \
    | grep -q '<string>660</string>'; then
  echo "ERROR: rendered hourly plist is missing --max-time 660" >&2
  exit 1
fi
if grep -Eq '<string>--retry(-delay|-connrefused)?</string>' \
    "$RENDERED_HOURLY_PLIST"; then
  echo "ERROR: rendered hourly plist contains a curl retry flag" >&2
  exit 1
fi
echo "  Validated hourly trigger: --max-time 660, no curl transport retries"

# Install both validated files through destination-local temporary files so a
# failed copy cannot leave a partially written plist behind.
mkdir -p "$HOME/.haystack"
mkdir -p "$PLIST_DIR"
chmod +x "$PROJECT_DIR/scripts/start-server.sh"
for plist in "${PLISTS[@]}"; do
  INSTALL_TEMP_FILE="$(mktemp "$PLIST_DIR/.${plist}.XXXXXX")"
  install -m 0644 "$RENDER_DIR/$plist" "$INSTALL_TEMP_FILE"
  mv -f "$INSTALL_TEMP_FILE" "$PLIST_DIR/$plist"
  INSTALL_TEMP_FILE=""
done

# Only now replace the loaded jobs. Validation failures above leave both the
# installed files and running jobs exactly as they were.
for label in com.haystack.server com.haystack.hourly; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
done
for plist in "${PLISTS[@]}"; do
  launchctl bootstrap "gui/$(id -u)" "$PLIST_DIR/$plist"
  echo "  Loaded: $plist"
done

echo "  Installed plist: ~/Library/LaunchAgents/com.haystack.hourly.plist"

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
echo "  Rerun ./scripts/launchd-install.sh after any launchd plist change."
echo ""
echo "Useful commands:"
echo "  launchctl list | grep haystack       # check status"
echo "  tail -f ~/.haystack/launchd-server.log  # server logs"
echo "  tail -f ~/.haystack/launchd-hourly.log  # hourly trigger logs"
