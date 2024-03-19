#!/bin/bash

# Terminate already running bar instances
killall -q polybar

# Launch Polybar using config.ini
# polybar mybar 2 >&1 | tee -a /tmp/polybar.log & disown
polybar &

# echo "Polybar launched..."
# 
# if type "xrandr"; then
# 	for m in $(xrandr --query | grep " connected" | cut -d" " -f1); do
# 		MONITOR=$m polybar --reload mybar &
# 	done
# else
# 	polybar --reload mybar &
# fi
