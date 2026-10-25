# Runs before every template. Expects PM_USER, PM_HOSTNAME, PM_SSH_KEYS and optionally PM_PASSWORD.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
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

if command -v cloud-init >/dev/null; then
  log "Waiting for cloud-init to finish"
  cloud-init status --wait >/dev/null 2>&1 || true
fi

log "Updating packages"
retry apt-get update -q
retry apt-get -y -q -o Dpkg::Options::=--force-confold dist-upgrade
apt_install ca-certificates curl wget git sudo tmux htop jq unzip less vim-tiny bash-completion gnupg locales build-essential openssh-server procps

if [ -f /etc/locale.gen ]; then
  sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
  locale-gen >/dev/null 2>&1 || true
  update-locale LANG=en_US.UTF-8 || true
fi

log "Setting up user $PM_USER"
if ! id -u "$PM_USER" >/dev/null 2>&1; then useradd -m -s /bin/bash "$PM_USER"; fi
usermod -aG sudo "$PM_USER"
echo "$PM_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-proxmiu-$PM_USER"
chmod 440 "/etc/sudoers.d/90-proxmiu-$PM_USER"
install -d -m 700 -o "$PM_USER" -g "$PM_USER" "/home/$PM_USER/.ssh"
AUTH_KEYS="/home/$PM_USER/.ssh/authorized_keys"
touch "$AUTH_KEYS"
printf '%s\n' "$PM_SSH_KEYS" >> "$AUTH_KEYS"
sort -u -o "$AUTH_KEYS" "$AUTH_KEYS"
sed -i '/^$/d' "$AUTH_KEYS"
chown "$PM_USER:$PM_USER" "$AUTH_KEYS"
chmod 600 "$AUTH_KEYS"
if [ -n "${PM_PASSWORD:-}" ]; then echo "$PM_USER:$PM_PASSWORD" | chpasswd; fi

install -d -m 700 -o "$PM_USER" -g "$PM_USER" "/home/$PM_USER/.config" "/home/$PM_USER/.config/proxmiu"
touch "$PM_ENV_FILE"
chmod 600 "$PM_ENV_FILE"
grep -q 'HOME/.local/bin' "$PM_ENV_FILE" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$PM_ENV_FILE"
for rc in .bashrc .profile; do
  f="/home/$PM_USER/$rc"
  touch "$f"
  # Prepend so it also applies to non-interactive shells (Debian's .bashrc returns early for those).
  grep -q 'proxmiu/env' "$f" || sed -i '1i [ -f "$HOME/.config/proxmiu/env" ] && . "$HOME/.config/proxmiu/env"' "$f"
  [ -s "$f" ] || echo '[ -f "$HOME/.config/proxmiu/env" ] && . "$HOME/.config/proxmiu/env"' > "$f"
  chown "$PM_USER:$PM_USER" "$f"
done

if systemd-detect-virt -q --vm 2>/dev/null; then
  apt_install qemu-guest-agent
  systemctl enable --now qemu-guest-agent >/dev/null 2>&1 || true
fi
systemctl enable --now ssh >/dev/null 2>&1 || true
