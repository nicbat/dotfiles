#
# ~/.bashrc
#

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

alias grep='grep --color=auto'
# kitten ssh so I can do clear in attu
# alias attu='ssh attu.cs.washington.edu'
# alias hyak='kitten ssh hyak'

# open command
alias open='xdg-open'
PS1='[\u@\h \W]\$ '

# simple
alias v='nvim'
alias z='cd'
alias c='clear'

# cd silliness
alias ..="cd .."
alias ...="cd ../.."
alias ....="cd ../../.."
alias .....="cd ../../../.."

# filesizes
alias sizecheck='ncdu'

# pacman and yay
# alias pacupdate='sudo pacman -Syu'
alias pacsearch='pacman -Q | grep '
# alias pacget='sudo pacman -S'

# tree with a little bit more formatting
alias tree='tree --dirsfirst -F'

# some folder aliases
# alias uw='cd ~/Projects/uwcs'

[ -f /opt/miniconda3/etc/profile.d/conda.sh ] && source /opt/miniconda3/etc/profile.d/conda.sh

source /etc/profile

# NOTE: /etc/profile (sourced above) already loads /etc/profile.d/*.sh itself
# and then does `unset -f append_path`. A second loop here re-ran those scripts
# after the helper was gone, which is where the "append_path: command not found"
# errors came from. Removed - `source /etc/profile` covers it.

export CRYPTOGRAPHY_OPENSSL_NO_LEGACY=1

function conda() {
  unset -f conda
  # <<< start else branch contents >>>
  if [ -f "/opt/miniconda3/etc/profile.d/conda.sh" ]; then
    . "/opt/miniconda3/etc/profile.d/conda.sh"
  else
    export PATH="/opt/miniconda3/bin:$PATH"
  fi
  # <<< end else branch contents >>>
  conda "$@"
}

# Created by `pipx` on 2024-03-16 14:03:36
export PATH="$PATH:/home/nicbat/.local/bin"

# set EDITOR to nvim
export EDITOR=/usr/bin/nvim

# start zoxide, replacing the cd command
eval "$(zoxide init bash --cmd cd)"
# zoxide ALSO wants to be at the end, but we'll ive starship priority and silence warnings with the following
export _ZO_DOCTOR=0

# ── modern CLI stack ──────────────────────────────────────────────────
# eza replaces ls. Remove/adjust any line here you don't get on with.
alias ls='eza --icons --group-directories-first'
alias la='eza -a --icons --group-directories-first'
alias ll='eza -l --icons --git --group-directories-first'
alias lt='eza --tree --level=2 --icons'
alias cat='bat'          # bat behaves exactly like cat when piped, so this is safe
alias lg='lazygit'
alias du='dust'

# fzf: Ctrl-R history search, Ctrl-T file picker, Alt-C cd. Guarded so a
# missing fzf doesn't spew errors on every new shell.
[ -f /usr/share/fzf/key-bindings.bash ] && source /usr/share/fzf/key-bindings.bash
[ -f /usr/share/fzf/completion.bash ]   && source /usr/share/fzf/completion.bash

# make sure this is at the very end of the file
eval "$(starship init bash)"
