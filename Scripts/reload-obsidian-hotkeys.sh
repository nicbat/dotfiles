#!/bin/bash

obsidian_path="/home/nicbat/Documents/Second Brain/.obsidian/"
hotkeys_path="${obsidian_path}hotkeys.json"
hotkeys_bak="${obsidian_path}hotkeys.json.bak"

cp "$hotkeys_path" "$hotkeys_bak"
cp "$hotkeys_bak" "$hotkeys_path"
