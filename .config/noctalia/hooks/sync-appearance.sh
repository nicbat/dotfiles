#!/usr/bin/env bash
set -euo pipefail
mode="${NOCTALIA_THEME_MODE:-$(noctalia msg theme-mode-get)}"
case "$mode" in dark|light) ;; *) exit 1 ;; esac
exec python3 /home/nicbat/.config/noctalia/hooks/gtk-refresh.py --appearance-only "$mode"
