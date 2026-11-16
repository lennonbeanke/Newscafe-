#!/usr/bin/env bash
# Shared Docker-engine guard for every script that talks to Docker (backend development scripts, repo secret scan, CI).
# Source this file; do not run it. It is the ONLY copy of need_docker: do not duplicate it.
# SAFETY: refuses to continue unless Docker talks to a LOCAL engine on this computer (see need_docker below).

# Container tools installed from the official release files into a user-owned folder (no Homebrew, no sudo).
NC_TOOLS="$HOME/.local/newscafe-tools"
[ -d "$NC_TOOLS/bin" ] && export PATH="$NC_TOOLS/bin:$NC_TOOLS/lima/bin:$PATH"

GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v8.30.1"

die() { echo "ERROR: $*" >&2; exit 1; }

# Refuses to continue unless Docker talks to the LOCAL Colima engine on this computer.
# DOCKER_HOST / DOCKER_CONTEXT could silently redirect every docker command to another machine, so they must be unset.
# (GitHub's CI runner has no Colima: there the only accepted engine is its own default local socket.)
need_docker() {
  local v ctx host
  for v in DOCKER_HOST DOCKER_CONTEXT; do
    [ -z "${!v:-}" ] || die "$v is set in your shell. Unset it; these scripts only use the local Colima engine."
  done
  command -v docker >/dev/null 2>&1 || die "docker is not installed. See backend/docs/SETUP.md (Colima)."
  ctx="$(docker context show 2>/dev/null)" || die "Cannot read the Docker context."
  host="$(docker context inspect "$ctx" --format '{{.Endpoints.docker.Host}}' 2>/dev/null)" || die "Cannot inspect Docker context '$ctx'."
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    [ "$host" = "unix:///var/run/docker.sock" ] || die "CI must use the runner's local Docker socket (got '$host')."
  elif [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
    # Windows (Git Bash) + Docker Desktop: accept only Docker Desktop's own local named pipe and engine.
    [ "$ctx" = "desktop-linux" ] || die "Docker context is '$ctx', not 'desktop-linux'. Run: docker context use desktop-linux"
    [ "$host" = "npipe:////./pipe/dockerDesktopLinuxEngine" ] || die "The 'desktop-linux' context points at '$host', not the local Docker Desktop pipe."
    docker info >/dev/null 2>&1 || die "Docker Desktop is not running. Start Docker Desktop."
    [ "$(docker info --format '{{.Name}}' 2>/dev/null)" = "docker-desktop" ] || die "The Docker engine is not the local Docker Desktop engine."
  else
    [ "$ctx" = "colima" ] || die "Docker context is '$ctx', not 'colima'. Run: docker context use colima"
    [ "$host" = "unix://$HOME/.colima/default/docker.sock" ] || die "The 'colima' context points at '$host', not the local Colima socket."
    docker info >/dev/null 2>&1 || die "The container runtime is not running. Start it with: backend/scripts/colima-up.sh"
    [ "$(docker info --format '{{.Name}}' 2>/dev/null)" = "colima" ] || die "The Docker engine is not the local Colima engine."
  fi
  docker info >/dev/null 2>&1 || die "The container runtime is not running. Start it with: backend/scripts/colima-up.sh"
}
