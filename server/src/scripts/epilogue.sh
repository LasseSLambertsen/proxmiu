# Optional extras, each driven by an OPT_* variable that templates opt into via their options.
if [ -n "${OPT_GIT_NAME:-}" ]; then as_user git config --global user.name "$OPT_GIT_NAME"; fi
if [ -n "${OPT_GIT_EMAIL:-}" ]; then as_user git config --global user.email "$OPT_GIT_EMAIL"; fi

if [ -n "${OPT_GITHUB_TOKEN:-}" ]; then
  log "Installing GitHub CLI"
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
  retry apt-get update -q
  apt_install gh
  printf '%s' "$OPT_GITHUB_TOKEN" | as_user gh auth login --with-token
  as_user gh auth setup-git
fi

if [ -n "${OPT_REPO_URL:-}" ]; then
  log "Cloning $OPT_REPO_URL"
  as_user mkdir -p "/home/$PM_USER/code"
  as_user git -C "/home/$PM_USER/code" clone "$OPT_REPO_URL" || log "warning: clone failed, continuing"
fi

if [ -n "${OPT_TAILSCALE_AUTHKEY:-}" ]; then
  log "Installing Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
  if [ ! -c /dev/net/tun ]; then
    # Unprivileged containers usually have no TUN device; userspace networking still supports Tailscale SSH.
    sed -i 's/^FLAGS=.*/FLAGS="--tun=userspace-networking"/' /etc/default/tailscaled
    systemctl restart tailscaled
  fi
  tailscale up --authkey="$OPT_TAILSCALE_AUTHKEY" --ssh --hostname="$PM_HOSTNAME"
fi

if [ "${OPT_TMUX_AUTOATTACH:-0}" = "1" ]; then
  log "Enabling persistent tmux sessions"
  cat > "/home/$PM_USER/.tmux.conf" <<'TMUX'
set -g mouse on
set -g history-limit 100000
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ",xterm-256color:Tc"
set -g status-style "bg=#18181b,fg=#a1a1aa"
TMUX
  chown "$PM_USER:$PM_USER" "/home/$PM_USER/.tmux.conf"
  if ! grep -q 'proxmiu: tmux' "/home/$PM_USER/.bashrc"; then
    cat >> "/home/$PM_USER/.bashrc" <<'RC'
# proxmiu: tmux - reattach to the same session on every SSH login (set PROXMIU_NO_TMUX=1 to skip)
if [ -n "$SSH_CONNECTION" ] && [ -z "$TMUX" ] && [ -t 1 ] && [ -z "${PROXMIU_NO_TMUX:-}" ] && command -v tmux >/dev/null; then
  tmux new-session -A -s main
fi
RC
  fi
fi

chown -R "$PM_USER:$PM_USER" "/home/$PM_USER/.config"
