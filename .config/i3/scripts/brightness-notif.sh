#!/bin/bash

declare -i BRIGHTNESS=$(brightnessctl get)/4

dunstify -i "no icon" -h int:value:$BRIGHTNESS "brightness"
