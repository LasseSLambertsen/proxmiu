#!/usr/bin/env bash
# Triggered by the Proxmiu agent user through a narrow sudoers rule.
# Starts the real update in a transient systemd unit so it survives the agent restart.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "error: run as root" >&2; exit 1; }

unset PROXMIU_REPO PROXMIU_REF PROXMIU_RAW_BASE PROXMIU_DATA_DIR
if [ -f /etc/proxmiu/update.env ]; then
  # Root-owned settings written by install.sh. Do not trust the caller's environment.
  # shellcheck disable=SC1091
  . /etc/proxmiu/update.env
fi

repo="${PROXMIU_REPO:-https://github.com/LasseSLambertsen/proxmiu.git}"
ref="${PROXMIU_REF:-main}"
raw="${PROXMIU_RAW_BASE:-}"
data_dir="${PROXMIU_DATA_DIR:-/var/lib/proxmiu}"

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
umask 022

printf '{"state":"running","startedAt":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$data_dir/self-update.json"
chmod 644 "$data_dir/self-update.json"

args=(
  --unit=proxmiu-self-update
  --collect
  --no-block
  --description="Proxmiu self-update"
  --property=StandardOutput=append:"$data_dir/self-update.log"
  --property=StandardError=append:"$data_dir/self-update.log"
  --setenv=PROXMIU_REPO="$repo"
  --setenv=PROXMIU_REF="$ref"
)
if [ -n "$raw" ]; then args+=(--setenv=PROXMIU_RAW_BASE="$raw"); fi

exec systemd-run "${args[@]}" /usr/local/lib/proxmiu/self-update-runner
