#!/usr/bin/env bash
# Run on a Proxmox VE host. Creates a small Debian container that starts at boot, installs the
# Proxmiu agent in it, and connects it to this host with a new API token.
#
#   CTID              container ID (default: next free)
#   CT_HOSTNAME       default proxmiu
#   STORAGE           container disk storage (default: first active storage for containers)
#   BRIDGE            default vmbr0
#   IP / GW           static address, e.g. IP=192.168.1.40/24 GW=192.168.1.1 (default: DHCP)
#   CORES MEMORY DISK default 2 cores, 1024 MiB, 8 GiB
#   CONNECT_HOST=0    skip creating an API token and registering this host
#   FULL_ACCESS=1     use a root@pam token instead of the limited proxmiu@pve user and role
#   ADD_SSH_KEY=1|0   trust the agent's SSH key on this host for browser terminals (default: ask)
#   PROXMIU_PASSWORD, PROXMIU_ALLOWED_ORIGINS, PROXMIU_TLS, PROXMIU_REF, GITHUB_TOKEN,
#   PROXMIU_ALLOW_SELF_UPDATE=1
#                     passed through to scripts/install.sh
set -euo pipefail

REF="${PROXMIU_REF:-main}"
RAW="${PROXMIU_RAW:-https://raw.githubusercontent.com/LasseSLambertsen/proxmiu}"

# What the agent uses: inventory and status, power actions, creating/cloning/deleting guests,
# downloading container templates, guest agent IPs and node reboot. Names missing on this
# Proxmox version are skipped.
PROXMIU_PRIVS="Sys.Audit Sys.PowerMgmt
  VM.Audit VM.PowerMgmt VM.Allocate VM.Clone VM.Monitor VM.GuestAgent.Audit
  VM.Config.CPU VM.Config.Memory VM.Config.Disk VM.Config.Network VM.Config.Options VM.Config.Cloudinit VM.Config.HWType
  Datastore.Audit Datastore.AllocateSpace Datastore.AllocateTemplate
  SDN.Audit SDN.Use"

log() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
json_str() { local s="${1//\\/\\\\}"; s="${s//\"/\\\"}"; printf '"%s"' "$s"; }
ask() { # ask "question" -> 0 for yes; defaults to no without a terminal
  [ -r /dev/tty ] || return 1
  local reply
  read -r -p "$1 [y/N] " reply </dev/tty || return 1
  [[ "$reply" =~ ^[Yy] ]]
}

# A dedicated user and role with only what Proxmiu uses, instead of a full-root token.
setup_proxmiu_user() {
  local available privs="" p
  available="$(pvesh get /access/roles/Administrator --output-format json | grep -o '"[A-Za-z.]*"' | tr -d '"')" || return 1
  for p in $PROXMIU_PRIVS; do
    if grep -qx "$p" <<<"$available"; then privs="$privs,$p"; fi
  done
  privs="${privs#,}"
  [ -n "$privs" ] || return 1
  if pveum role list --output-format json | grep -Eq '"roleid": ?"Proxmiu"'; then
    pveum role modify Proxmiu --privs "$privs" || return 1
  else
    pveum role add Proxmiu --privs "$privs" || return 1
  fi
  if ! pveum user list --output-format json | grep -Eq '"userid": ?"proxmiu@pve"'; then
    pveum user add proxmiu@pve --comment "Proxmiu agent (API tokens only, no password)" || return 1
  fi
  pveum acl modify / --users proxmiu@pve --roles Proxmiu
}

[ "$(id -u)" = 0 ] || die "Run as root on the Proxmox host."
command -v pct >/dev/null && command -v pveam >/dev/null || die "This script must run on a Proxmox VE host."

CTID="${CTID:-$(pvesh get /cluster/nextid)}"
CT_HOSTNAME="${CT_HOSTNAME:-proxmiu}"
BRIDGE="${BRIDGE:-vmbr0}"
CORES="${CORES:-2}"
MEMORY="${MEMORY:-1024}"
DISK="${DISK:-8}"
STORAGE="${STORAGE:-$(pvesm status --content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}')}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-$(pvesm status --content vztmpl 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}')}"
[ -n "$STORAGE" ] || die "No active storage for containers found; set STORAGE."
[ -n "$TEMPLATE_STORAGE" ] || die "No active storage for container templates found; set TEMPLATE_STORAGE."
pct status "$CTID" >/dev/null 2>&1 && die "Container $CTID already exists; set CTID."

NET="ip=dhcp"
[ -n "${IP:-}" ] && NET="ip=$IP${GW:+,gw=$GW}"
PASSWORD="${PROXMIU_PASSWORD:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)}"

log "Finding the latest Debian 12 template"
pveam update >/dev/null || true
TEMPLATE="$(pveam available --section system | awk '{print $2}' | grep -E '^debian-12-standard_.*_amd64\.tar\.(zst|gz|xz)$' | sort -V | tail -1)"
[ -n "$TEMPLATE" ] || die "Could not find a Debian 12 template via pveam."
if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
  log "Downloading $TEMPLATE"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE" >/dev/null
fi

log "Creating container $CTID ($CT_HOSTNAME) on $STORAGE"
pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" --memory "$MEMORY" --swap 512 \
  --rootfs "$STORAGE:$DISK" \
  --net0 "name=eth0,bridge=$BRIDGE,$NET" \
  --unprivileged 1 --features nesting=1 \
  --onboot 1 --startup order=90 \
  --tags proxmiu \
  --description "Proxmiu agent. Update: pct exec $CTID -- /usr/local/bin/proxmiu-update" >/dev/null
pct start "$CTID"

log "Waiting for the container network"
CT_IP=""
for _ in $(seq 1 60); do
  CT_IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')" || true
  if [ -n "$CT_IP" ] && pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1; then break; fi
  sleep 2
done
[ -n "$CT_IP" ] || die "Container $CTID got no IP address. Check that $BRIDGE has DHCP, or set IP and GW."

log "Installing Proxmiu in the container"
pct exec "$CTID" -- env DEBIAN_FRONTEND=noninteractive bash -c 'apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null'
# Run from a checkout: use the install.sh next to this file. Run via curl: download it.
SCRIPT_DIR=""
if [ -f "${BASH_SOURCE[0]:-}" ]; then SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/install.sh" ]; then
  pct push "$CTID" "$SCRIPT_DIR/install.sh" /root/proxmiu-install.sh --perms 755
else
  pct exec "$CTID" -- env URL="$RAW/$REF/scripts/install.sh" GITHUB_TOKEN="${GITHUB_TOKEN:-}" bash -c \
    'curl -fsSL ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} "$URL" -o /root/proxmiu-install.sh && chmod 755 /root/proxmiu-install.sh'
fi
pct exec "$CTID" -- env \
  PROXMIU_PASSWORD="$PASSWORD" \
  PROXMIU_REF="$REF" \
  PROXMIU_TLS="${PROXMIU_TLS:-0}" \
  PROXMIU_ALLOWED_ORIGINS="${PROXMIU_ALLOWED_ORIGINS:-}" \
  PROXMIU_ALLOW_SELF_UPDATE="${PROXMIU_ALLOW_SELF_UPDATE:-0}" \
  GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
  /root/proxmiu-install.sh
pct exec "$CTID" -- rm -f /root/proxmiu-install.sh

SCHEME=http
[ "${PROXMIU_TLS:-0}" = 1 ] && SCHEME=https
AGENT="$SCHEME://$CT_IP:8787"

if [ "${CONNECT_HOST:-1}" = 1 ]; then
  log "Connecting the agent to this Proxmox host"
  HOST_IP="$(ip -4 -o addr show "$BRIDGE" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
  PVE_USER=proxmiu@pve
  if [ "${FULL_ACCESS:-0}" = 1 ]; then
    PVE_USER=root@pam
  elif ! setup_proxmiu_user; then
    echo "    Could not set up the proxmiu@pve user and role; falling back to manual setup." >&2
    PVE_USER=""
  fi
  TOKEN_NAME="${TOKEN_NAME:-agent-$CTID}"
  SECRET=""
  [ -n "$PVE_USER" ] && SECRET="$(pveum user token add "$PVE_USER" "$TOKEN_NAME" --privsep 0 --output-format json 2>/dev/null |
    sed -n 's/.*"value"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' || true)"
  SESSION="$(curl -fsk "$AGENT/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"password\":$(json_str "$PASSWORD")}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p' || true)"
  if [ -n "$HOST_IP" ] && [ -n "$SECRET" ] && [ -n "$SESSION" ] &&
    curl -fsk "$AGENT/api/clusters" -H "Authorization: Bearer $SESSION" -H 'Content-Type: application/json' \
      -d "{\"host\":\"$HOST_IP\",\"port\":8006,\"authType\":\"token\",\"username\":\"$PVE_USER!$TOKEN_NAME\",\"secret\":\"$SECRET\",\"verifyTls\":false}" >/dev/null; then
    echo "    Added $HOST_IP with API token $PVE_USER!$TOKEN_NAME"
  else
    echo "    Could not connect automatically; add this host under Connections in the UI."
  fi

  if [ "${ADD_SSH_KEY:-ask}" = 1 ] || { [ "${ADD_SSH_KEY:-ask}" = ask ] && ask "Allow browser terminals to this Proxmox host (adds the agent's SSH key for root)?"; }; then
    KEY="$(curl -fsk "$AGENT/api/settings" -H "Authorization: Bearer $SESSION" | sed -n 's/.*"sshPublicKey":"\([^"]*\)".*/\1/p' || true)"
    if [ -n "$KEY" ]; then
      # On clustered hosts this file is shared through /etc/pve, so every node trusts the key.
      mkdir -p /root/.ssh && chmod 700 /root/.ssh
      grep -qxF "$KEY" /root/.ssh/authorized_keys 2>/dev/null || echo "$KEY" >> /root/.ssh/authorized_keys
      echo "    Added the agent's SSH key to /root/.ssh/authorized_keys"
    fi
  fi
fi

printf '\n\033[1;32mProxmiu is ready.\033[0m Container %s starts automatically with this host.\n\n' "$CTID"
printf '  Open:      %s\n' "$AGENT"
printf '  Password:  %s\n' "$PASSWORD"
printf '  Update:    pct exec %s -- /usr/local/bin/proxmiu-update\n' "$CTID"
printf '  Logs:      pct exec %s -- journalctl -u proxmiu -f\n' "$CTID"
printf '  Settings:  pct exec %s -- nano /etc/proxmiu/proxmiu.env   (then: systemctl restart proxmiu)\n\n' "$CTID"
