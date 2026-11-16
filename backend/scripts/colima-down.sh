#!/usr/bin/env bash
# Stops the Colima VM (data volumes are kept).
set -euo pipefail
NC_TOOLS="$HOME/.local/newscafe-tools"
[ -d "$NC_TOOLS/bin" ] && export PATH="$NC_TOOLS/bin:$NC_TOOLS/lima/bin:$PATH"
colima stop
