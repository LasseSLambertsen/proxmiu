log() { echo "==> $*"; }
retry() { local n=0; until "$@"; do n=$((n+1)); [ "$n" -ge 5 ] && return 1; echo "retrying in 5s..."; sleep 5; done; }
apt_install() { retry apt-get install -y -q --no-install-recommends "$@"; }
as_user() { sudo -u "$PM_USER" -H "$@"; }
as_user_sh() { sudo -u "$PM_USER" -H bash -lc "$1"; }
PM_ENV_FILE="/home/$PM_USER/.config/proxmiu/env"
persist_env() {
  touch "$PM_ENV_FILE"
  sed -i "/^export $1=/d" "$PM_ENV_FILE"
  printf 'export %s=%q\n' "$1" "$2" >> "$PM_ENV_FILE"
}
install_node() {
  if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then return 0; fi
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt_install nodejs
}
