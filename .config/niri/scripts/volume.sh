#!/bin/bash
# Adjust the default sink volume, snapping to the nearest multiple of STEP%.
# Usage: volume.sh up|down [step]
#   up   -> next multiple of step above the current level
#   down -> previous multiple of step below the current level
#   step -> increment in percent (default 5)
# Volume is capped at 100% and floored at 0%.

SINK="@DEFAULT_AUDIO_SINK@"
STEP="${2:-5}"

# Current volume as an integer percentage (e.g. "Volume: 0.40" -> 40).
cur=$(wpctl get-volume "$SINK" | awk '{print int($2 * 100 + 0.5)}')

case "$1" in
    up)   new=$(( (cur / STEP) * STEP + STEP )) ;;
    down) new=$(( ((cur + STEP - 1) / STEP) * STEP - STEP )) ;;
    *)    echo "usage: $0 up|down" >&2; exit 1 ;;
esac

(( new > 100 )) && new=100
(( new < 0 ))   && new=0

wpctl set-volume -l 1.0 "$SINK" "${new}%"
