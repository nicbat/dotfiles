#!/bin/bash
# Adjust backlight brightness, snapping to the nearest multiple of STEP%.
# Usage: brightness.sh up|down [step]
#   up   -> next multiple of step above the current level
#   down -> previous multiple of step below the current level
#   step -> increment in percent (default 5)
# Brightness is capped at 100% and floored at 1% (never fully off).

STEP="${2:-5}"

# brightnessctl -m -> "name,class,current,percent,max"; field 4 is the percentage.
cur=$(brightnessctl -m | awk -F, '{print $4}' | tr -d '%')

case "$1" in
    up)   new=$(( (cur / STEP) * STEP + STEP )) ;;
    down) new=$(( ((cur + STEP - 1) / STEP) * STEP - STEP )) ;;
    *)    echo "usage: $0 up|down [step]" >&2; exit 1 ;;
esac

(( new > 100 )) && new=100
(( new < 1 ))   && new=1

brightnessctl --class=backlight set "${new}%" >/dev/null
