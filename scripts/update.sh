#!/usr/bin/env bash
# Updates an existing Proxmiu agent installation.
#
# Re-runs scripts/install.sh from the same repository and ref. Settings in
# /etc/proxmiu/proxmiu.env and all data in /var/lib/proxmiu are kept.
#
#   PROXMIU_REPO       git remote, default the public repository
#   PROXMIU_REF        branch or tag, default main
#   PROXMIU_RAW_BASE   raw file base URL for a non-GitHub mirror
set -euo pipefail

ENV_REPO="${PROXMIU_REPO:-}"
ENV_REF="${PROXMIU_REF:-}"
ENV_RAW="${PROXMIU_RAW_BASE:-}"

if [ -f /etc/proxmiu/update.env ]; then
  # Root-owned settings written by install.sh.
  # shellcheck disable=SC1091
  . /etc/proxmiu/update.env
fi

REPO="${ENV_REPO:-${PROXMIU_REPO:-https://github.com/LasseSLambertsen/proxmiu.git}}"
REF="${ENV_REF:-${PROXMIU_REF:-main}}"
RAW_BASE="${ENV_RAW:-${PROXMIU_RAW_BASE:-}}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
log() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }

[ "$(id -u)" = 0 ] || die "Run as root (try: sudo proxmiu-update)."

if [ -z "$RAW_BASE" ]; then
  case "$REPO" in
  https://github.com/*)
    path="${REPO#https://github.com/}"
    path="${path%.git}"
    RAW_BASE="https://raw.githubusercontent.com/$path"
    ;;
  *)
    die "Set PROXMIU_RAW_BASE when PROXMIU_REPO is not a GitHub URL."
    ;;
  esac
fi

url="${RAW_BASE%/}/$REF/scripts/install.sh"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

log "Fetching the Proxmiu installer ($REF)"
curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 10 "$url" -o "$tmp"
export PROXMIU_REPO="$REPO" PROXMIU_REF="$REF"
if [ -n "$RAW_BASE" ]; then export PROXMIU_RAW_BASE="$RAW_BASE"; fi
bash "$tmp" "$@"
