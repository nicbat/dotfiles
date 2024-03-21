#
# ~/.bashrc
#

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

alias ls='ls --color=auto'
alias grep='grep --color=auto'
# kitten ssh so I can do clear in attu
alias attu='kitten ssh attu.cs.washington.edu'
PS1='[\u@\h \W]\$ '

# close window when not in use for TMOUT time
#TMOUT=120

eval "$(starship init bash)"
[ -f /opt/miniconda3/etc/profile.d/conda.sh ] && source /opt/miniconda3/etc/profile.d/conda.sh

source /etc/profile

# Load profiles from /etc/profile.d
if test -d /etc/profile.d/; then
	for profile in /etc/profile.d/*.sh; do
		test -r "$profile && . $profile"
	done
	unset profile
fi

# >>> conda initialize >>>
# !! Contents within this block are managed by 'conda init' !!
__conda_setup="$('/opt/miniconda3/bin/conda' 'shell.bash' 'hook' 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__conda_setup"
else
    if [ -f "/opt/miniconda3/etc/profile.d/conda.sh" ]; then
        . "/opt/miniconda3/etc/profile.d/conda.sh"
    else
        export PATH="/opt/miniconda3/bin:$PATH"
    fi
fi
unset __conda_setup
# <<< conda initialize <<<


# Created by `pipx` on 2024-03-16 14:03:36
export PATH="$PATH:/home/nicbat/.local/bin"

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/home/nicbat/Sources/google-cloud-sdk/path.bash.inc' ]; then . '/home/nicbat/Sources/google-cloud-sdk/path.bash.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/home/nicbat/Sources/google-cloud-sdk/completion.bash.inc' ]; then . '/home/nicbat/Sources/google-cloud-sdk/completion.bash.inc'; fi

# start zoxide, replacing the cd command
eval "$(zoxide init bash --cmd cd)"
