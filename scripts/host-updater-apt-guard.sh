#!/bin/sh
set -eu
if [ "$#" -ne 1 ] || [ "${#1}" -ne 32 ]; then
  exit 1
fi
case "$1" in
  *[!a-f0-9]*) exit 1 ;;
esac
exec /usr/bin/python3 -I /usr/local/lib/proxmiu/host-updater --guard "$1"
