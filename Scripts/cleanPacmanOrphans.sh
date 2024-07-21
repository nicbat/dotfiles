#!/bin/bash

exec sudo pacman -Rns $(pacman -Qtdq)
