#!/usr/bin/env bash
# Installs or updates the Proxmiu agent as a systemd service on Debian or Ubuntu.
# Re-running it updates the code and restarts the service; settings and data are kept.
#
#   PROXMIU_PASSWORD         login password (generated on first install if empty)
#   PROXMIU_ALLOWED_ORIGINS  hosted UIs allowed to use the agent, e.g. https://you.vercel.app
#   PROXMIU_TLS=1            serve HTTPS with a self-signed certificate
#   PORT                     default 8787
#   PROXMIU_REF              git branch or tag, default main
#   PROXMIU_ALLOW_SELF_UPDATE=1  enable the opt-in update button in Settings
#   GITHUB_TOKEN             only needed for a private repository
set -euo pipefail

REPO="${PROXMIU_REPO:-https://github.com/LasseSLambertsen/proxmiu.git}"
REF="${PROXMIU_REF:-main}"
APP_DIR=/opt/proxmiu
DATA_DIR=/var/lib/proxmiu
ENV_FILE=/etc/proxmiu/proxmiu.env
UNIT_FILE=/etc/systemd/system/proxmiu.service
SELF_UPDATE_FILE=/etc/proxmiu/self-update
SELF_UPDATE_HELPER=/usr/local/bin/proxmiu-self-update
SELF_UPDATE_RUNNER=/usr/local/lib/proxmiu/self-update-runner
SUDOERS_FILE=/etc/sudoers.d/90-proxmiu-self-update

log() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Run as root."
command -v apt-get >/dev/null || die "This installer supports Debian and Ubuntu."
command -v systemctl >/dev/null || die "systemd is required."

export DEBIAN_FRONTEND=noninteractive
log "Installing packages"
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl git openssl sudo >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
NODE_BIN="$(command -v node)"

id proxmiu >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin proxmiu
install -d -m 700 -o proxmiu -g proxmiu "$DATA_DIR"
install -d -m 755 /etc/proxmiu

ENABLE_SELF_UPDATE="${PROXMIU_ALLOW_SELF_UPDATE:-}"
if [ -z "$ENABLE_SELF_UPDATE" ] && [ -f "$SELF_UPDATE_FILE" ]; then
  ENABLE_SELF_UPDATE="$(cat "$SELF_UPDATE_FILE" 2>/dev/null || true)"
fi
case "${ENABLE_SELF_UPDATE:-0}" in
1 | yes | true | on) ENABLE_SELF_UPDATE=1 ;;
*) ENABLE_SELF_UPDATE=0 ;;
esac

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

SAFE_REPO="$REPO"
case "$SAFE_REPO" in
*://*@*) SAFE_REPO="${SAFE_REPO#*://}"; SAFE_REPO="https://${SAFE_REPO#*@}" ;;
esac
RAW_BASE="${PROXMIU_RAW_BASE:-}"
if [ -z "$RAW_BASE" ]; then
  case "$SAFE_REPO" in
  https://github.com/*)
    repo_path="${SAFE_REPO#https://github.com/}"
    RAW_BASE="https://raw.githubusercontent.com/${repo_path%.git}"
    ;;
  esac
fi

# Install root-owned helpers from the same ref as the code, not from the
# proxmiu-owned checkout: the agent must not be able to alter a root helper.
fetch_script() {
  local dest="$1" rel="$2" tmp="$1.tmp"
  if [ -n "$RAW_BASE" ]; then
    if [ -n "${GITHUB_TOKEN:-}" ]; then
      curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 10 -H "Authorization: Bearer $GITHUB_TOKEN" "$RAW_BASE/$REF/$rel" -o "$tmp"
    else
      curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 10 "$RAW_BASE/$REF/$rel" -o "$tmp"
    fi
  else
    cp "$APP_DIR/$rel" "$tmp"
  fi
  chmod 755 "$tmp"
  mv -f "$tmp" "$dest"
}

fetch_script /usr/local/bin/proxmiu-update scripts/update.sh

if [ "$ENABLE_SELF_UPDATE" = 1 ]; then
  install -d -m 755 /usr/local/lib/proxmiu
  fetch_script "$SELF_UPDATE_RUNNER" scripts/self-update-runner.sh
  fetch_script "$SELF_UPDATE_HELPER" scripts/self-update-helper.sh
  sudoers_tmp="$(mktemp)"
  printf 'proxmiu ALL=(root) NOPASSWD: %s\n' "$SELF_UPDATE_HELPER" > "$sudoers_tmp"
  visudo -cf "$sudoers_tmp" >/dev/null
  install -m 440 -o root -g root "$sudoers_tmp" "$SUDOERS_FILE"
  rm -f "$sudoers_tmp"
else
  rm -f "$SELF_UPDATE_HELPER" "$SELF_UPDATE_RUNNER" "$SUDOERS_FILE"
fi
printf '%s\n' "$ENABLE_SELF_UPDATE" > "$SELF_UPDATE_FILE"
chmod 644 "$SELF_UPDATE_FILE"

{
  printf 'PROXMIU_REPO=%q\n' "$SAFE_REPO"
  printf 'PROXMIU_REF=%q\n' "$REF"
  printf 'PROXMIU_DATA_DIR=%q\n' "$DATA_DIR"
  printf 'PROXMIU_ALLOW_SELF_UPDATE=%q\n' "$ENABLE_SELF_UPDATE"
  if [ -n "$RAW_BASE" ]; then printf 'PROXMIU_RAW_BASE=%q\n' "$RAW_BASE"; fi
} > /etc/proxmiu/update.env
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
printf '  Settings:  %s\n  Logs:      journalctl -u proxmiu -f\n  Update:    proxmiu-update\n' "$ENV_FILE"
if [ "$ENABLE_SELF_UPDATE" = 1 ]; then
  printf '  UI update: Settings -> Update agent\n\n'
else
  printf '  UI update: off (PROXMIU_ALLOW_SELF_UPDATE=1 enables it)\n\n'
fi
