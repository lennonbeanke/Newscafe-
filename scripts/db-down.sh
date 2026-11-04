#!/usr/bin/env bash
# Stops the local development database (the data volume is kept).
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev
compose down
