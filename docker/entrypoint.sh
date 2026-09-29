#!/bin/sh
# Container entrypoint: prepare the workspace, then hand over to the supervisor.
#
# Idempotent by construction. Docker restarts this on every `up`, and an
# entrypoint that fails on the second run turns a restart into a crash loop.

set -eu

log() { printf '[entrypoint] %s\n' "$*"; }

WORKSPACE_FILE="${COD_WORKSPACE_FILE:-/cod/cod.json}"

# The workspace file is bind-mounted read-only, so it is read, never written.
if [ ! -f "$WORKSPACE_FILE" ]; then
  log "no workspace file at $WORKSPACE_FILE"
else
  log "workspace found at $WORKSPACE_FILE"
fi

mkdir -p /work

# One directory per worker, owned by the uid the agent runs as. Convention, not
# enforcement: on a shared mount, mode bits give no write isolation between
# agents. See docs/SECURITY_POSTURE.md.
#
# The list is derived from the workspace file so a new department needs no
# change here.
workers="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([a-z0-9][a-z0-9-]*\)".*/\1/p' \
  "$WORKSPACE_FILE" 2>/dev/null || true)"

if [ -n "$workers" ]; then
  for worker in $workers; do
    mkdir -p "/work/$worker"
    chmod 755 "/work/$worker"
  done
  log "prepared work directories: $(echo $workers | tr '\n' ' ')"
fi

# There are no credentials to install. opencode is unauthenticated by design,
# and this line exists so nobody adds one here later without noticing that it
# would change the security posture.
log "no credentials are installed; this is intentional"

# Bun.cron is the scheduler. Below 1.3.12 it does not exist, and a scheduler
# that silently never fires is worse than one that refuses to start.
if [ -n "$(command -v bun)" ]; then
  bun_version="$(bun --version)"
  log "bun $bun_version"
  if ! bun -e 'process.exit(typeof Bun.cron === "function" ? 0 : 1)' 2>/dev/null; then
    log "FATAL: Bun.cron is unavailable below Bun 1.3.12; no cron job would ever fire"
    exit 2
  fi
  log "Bun.cron is available"
fi

log "opencode $(opencode --version 2>/dev/null || echo unknown)"

# Block. The supervisor is started by the CLI with docker exec, so that a
# crashed supervisor is visible as a failed exec rather than a container that
# quietly restarts into a failure loop.
log "ready; the container blocks here and the CLI drives work with docker exec"
tail -f /dev/null
