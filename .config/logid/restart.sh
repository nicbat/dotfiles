#!/usr/bin/env bash
# Apply changes to logid.cfg. Run from anywhere: ~/.config/logid/restart.sh
set -euo pipefail

echo "Restarting logid..."
sudo systemctl restart logid
sleep 1

# Surface config errors instead of failing silently. logid logs a WARN and
# carries on with a partly-loaded config, so the service can be "active" while
# your binds are quietly broken.
if journalctl -u logid --since "5 seconds ago" --no-pager -q | grep -q 'WARN'; then
    echo
    echo "!! logid reported config warnings:"
    journalctl -u logid --since "5 seconds ago" --no-pager -q | grep 'WARN'
    echo
    echo "   Line numbers refer to logid.cfg. See README.md."
    exit 1
fi

systemctl is-active --quiet logid && echo "OK - logid running, config clean."
