#!/usr/bin/env bash
# Runs in a transient systemd unit started by self-update-helper.sh.
set -euo pipefail

if [ -f /etc/proxmiu/update.env ]; then
  # Root-owned settings written by install.sh.
  # shellcheck disable=SC1091
  . /etc/proxmiu/update.env
fi

data_dir="${PROXMIU_DATA_DIR:-/var/lib/proxmiu}"
status="$data_dir/self-update.json"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
umask 022

if /usr/local/bin/proxmiu-update; then
  printf '{"state":"success","startedAt":"%s","finishedAt":"%s"}\n' "$started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$status"
else
  rc=$?
  printf '{"state":"failed","startedAt":"%s","finishedAt":"%s"}\n' "$started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$status"
  exit "$rc"
fi
chmod 644 "$status"
