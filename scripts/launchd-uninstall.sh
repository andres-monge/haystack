#!/bin/bash
# Uninstall Haystack launchd agents.

set -euo pipefail

PLIST_DIR="$HOME/Library/LaunchAgents"

echo "Uninstalling Haystack launchd agents..."

for label in com.haystack.server com.haystack.hourly; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$PLIST_DIR/$label.plist"
  echo "  Removed: $label"
done

# Remove log rotation config if it exists
if [ -f /etc/newsyslog.d/haystack.conf ]; then
  if [ -w /etc/newsyslog.d ] || sudo -n true 2>/dev/null; then
    sudo rm -f /etc/newsyslog.d/haystack.conf
    echo "  Removed: log rotation config"
  else
    echo "  Skipped: log rotation removal (run with sudo to remove)"
  fi
fi

echo ""
echo "Done! Agents uninstalled."
echo "Logs and outputs in ~/.haystack/ are preserved (delete manually if desired)."
