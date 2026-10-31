#!/usr/bin/env bash
# Installs or updates the Proxmiu agent as a systemd service on Debian or Ubuntu.
# Re-running it updates the code and restarts the service; settings and data are kept.
#
#   PROXMIU_PASSWORD         login password (generated on first install if empty)
#   PROXMIU_ALLOWED_ORIGINS  hosted UIs allowed to use the agent, e.g. https://you.vercel.app
#   PROXMIU_TLS=1            serve HTTPS with a self-signed certificate
#   PORT                     default 8787
#   PROXMIU_REF              git branch or tag, default main
#   GITHUB_TOKEN             only needed while the repository is private
set -euo pipefail

REPO="${PROXMIU_REPO:-https://github.com/LasseSLambertsen/proxmiu.git}"
REF="${PROXMIU_REF:-main}"
APP_DIR=/opt/proxmiu
DATA_DIR=/var/lib/proxmiu
ENV_FILE=/etc/proxmiu/proxmiu.env
UNIT_FILE=/etc/systemd/system/proxmiu.service

log() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Run as root."
command -v apt-get >/dev/null || die "This installer supports Debian and Ubuntu."
command -v systemctl >/dev/null || die "systemd is required."

export DEBIAN_FRONTEND=noninteractive
log "Installing packages"
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl git openssl >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
NODE_BIN="$(command -v node)"

id proxmiu >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin proxmiu
install -d -m 700 -o proxmiu -g proxmiu "$DATA_DIR"
install -d -m 755 /etc/proxmiu

# The token is only used for this fetch and never stored in the checkout.
fetch_url="$REPO"
if [ -n "${GITHUB_TOKEN:-}" ]; then fetch_url="${REPO/https:\/\//https://x-access-token:${GITHUB_TOKEN}@}"; fi

log "Fetching Proxmiu ($REF)"
# The checkout belongs to the service user; tell git that root may update it.
git_app() { git -c safe.directory="$APP_DIR" -C "$APP_DIR" "$@"; }
if [ -d "$APP_DIR/.git" ]; then
  git_app fetch -q --depth 1 "$fetch_url" "$REF"
  git_app reset -q --hard FETCH_HEAD
else
  [ -e "$APP_DIR" ] && die "$APP_DIR exists but is not a Proxmiu checkout; move it away first."
  git clone -q --depth 1 --branch "$REF" "$fetch_url" "$APP_DIR"
  git_app remote set-url origin "$REPO"
fi

log "Building (this takes a minute)"
cd "$APP_DIR"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent >/dev/null
npm prune --omit=dev --no-audit --no-fund --loglevel=error
chown -R proxmiu:proxmiu "$APP_DIR"

if [ -f "$APP_DIR/scripts/update.sh" ]; then
  install -m 755 "$APP_DIR/scripts/update.sh" /usr/local/bin/proxmiu-update
fi
printf 'PROXMIU_REF=%q\n' "$REF" > /etc/proxmiu/update.env
chmod 644 /etc/proxmiu/update.env

# Writes KEY="value" to the env file, replacing an existing line.
set_env() {
  local value="${2//\\/\\\\}"
  value="${value//\"/\\\"}"
  sed -i "/^$1=/d" "$ENV_FILE"
  printf '%s="%s"\n' "$1" "$value" >> "$ENV_FILE"
}

NEW_PASSWORD=""
if [ ! -f "$ENV_FILE" ]; then
  log "Writing $ENV_FILE"
  install -m 600 /dev/null "$ENV_FILE"
  NEW_PASSWORD="${PROXMIU_PASSWORD:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)}"
  set_env PROXMIU_PASSWORD "$NEW_PASSWORD"
  set_env HOST 0.0.0.0
  set_env PORT "${PORT:-8787}"
  set_env PROXMIU_DATA_DIR "$DATA_DIR"
  set_env PROXMIU_TLS "${PROXMIU_TLS:-0}"
  set_env PROXMIU_ALLOWED_ORIGINS "${PROXMIU_ALLOWED_ORIGINS:-}"
else
  # Only settings passed explicitly on this run are changed.
  for key in PROXMIU_PASSWORD PORT PROXMIU_TLS PROXMIU_ALLOWED_ORIGINS; do
    if [ -n "${!key+x}" ]; then set_env "$key" "${!key}"; fi
  done
fi

log "Installing systemd service"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Proxmiu agent
Documentation=https://github.com/LasseSLambertsen/proxmiu
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=proxmiu
Group=proxmiu
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN dist/server/index.js
Restart=on-failure
RestartSec=3
# Kept to settings that also work in unprivileged containers.
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q proxmiu
systemctl restart proxmiu

port="$(sed -n 's/^PORT="\(.*\)"/\1/p' "$ENV_FILE")"
scheme=http
grep -q '^PROXMIU_TLS="1"' "$ENV_FILE" && scheme=https
for _ in $(seq 1 30); do
  curl -fsk "$scheme://127.0.0.1:$port/api/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -fsk "$scheme://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
  journalctl -u proxmiu -n 30 --no-pager || true
  die "The service did not come up. See the log above."
fi

ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
printf '\n\033[1;32mProxmiu is running\033[0m and starts automatically at boot.\n\n'
printf '  Open:      %s://%s:%s\n' "$scheme" "${ip:-<this-machine>}" "$port"
if [ -n "$NEW_PASSWORD" ]; then
  printf '  Password:  %s\n' "$NEW_PASSWORD"
elif [ -n "${PROXMIU_PASSWORD+x}" ]; then
  printf '  Password:  updated to the one you passed\n'
else
  printf '  Password:  unchanged (see %s)\n' "$ENV_FILE"
fi
printf '  Settings:  %s\n  Logs:      journalctl -u proxmiu -f\n  Update:    proxmiu-update\n\n' "$ENV_FILE"
