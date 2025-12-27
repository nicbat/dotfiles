#
# ~/.bashrc
#

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

alias ls='ls --color=auto'
alias grep='grep --color=auto'
# kitten ssh so I can do clear in attu
# alias attu='kitten ssh attu.cs.washington.edu'
# alias hyak='kitten ssh hyak'

# open command
alias open='xdg-open'
PS1='[\u@\h \W]\$ '

# simple
alias v='nvim'
alias z='cd'
alias c='clear'
alias la='ls -a'

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

# Load profiles from /etc/profile.d
if test -d /etc/profile.d/; then
	for profile in /etc/profile.d/*.sh; do
		test -r "$profile && . $profile"
	done
	unset profile
fi

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

# make sure this is at the very end of the file
eval "$(starship init bash)"
