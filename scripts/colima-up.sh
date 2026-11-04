#!/usr/bin/env bash
# Starts the Colima container VM on demand (2 CPUs, 2 GB RAM, 20 GB disk). Not started at login.
# Uses Apple's built-in virtualisation (vz), so QEMU is not needed.
set -euo pipefail
NC_TOOLS="$HOME/.local/newscafe-tools"
[ -d "$NC_TOOLS/bin" ] && export PATH="$NC_TOOLS/bin:$NC_TOOLS/lima/bin:$PATH"
command -v colima >/dev/null || { echo "colima is not installed. See docs/SETUP.md."; exit 1; }
colima status >/dev/null 2>&1 && { echo "Colima is already running."; exit 0; }
colima start --cpu 2 --memory 2 --disk 20 --vm-type vz
