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
# The list comes from the workspace schema via Bun, NOT from grepping the file.
# The previous `sed 's/.*"name".../'` matched every "name" in the document, so it
# created directories for the company, the departments AND every cron job -
# `acme engineering builder reviewer tester heartbeat nightly`. Wrong, and
# quietly so. The schema knows what a worker is; ask it.
if [ -f "$WORKSPACE_FILE" ]; then
  # The error is captured, not discarded. An earlier version used
  # `2>/dev/null || true`, which turned a hard schema mismatch into a bare
  # "refusing to guess" - the real cause was lost, and the container just
  # failed to start. Silent failure of a guard is how you lose an hour.
  worker_err=""
  if ! workers="$(cod-workers "$WORKSPACE_FILE" 2>/tmp/workers.err)"; then
    worker_err="$(cat /tmp/workers.err 2>/dev/null || echo unknown error)"
  fi
  rm -f /tmp/workers.err

  if [ -z "$workers" ]; then
    log "FATAL: could not read workers from $WORKSPACE_FILE; refusing to guess"
    [ -n "$worker_err" ] && log "reason: $worker_err" >&2
    exit 2
  fi

  for worker in $workers; do
    mkdir -p "/work/$worker"
    chmod 755 "/work/$worker"
  done
  log "prepared $(printf '%s\n' $workers | wc -l) worker directories"

  # A git repository in /work, so per-job worktrees have something to branch
  # from. `git worktree add` needs a repo; without this the isolation design in
  # src/worktree.ts has nothing to attach to and every job would have to share
  # one checkout - the exact race it exists to prevent.
  #
  # Idempotent: a restart must NOT reinitialise and lose committed work, so this
  # only initialises when /work/.git is genuinely absent.
  if [ ! -d /work/.git ]; then
    git init -q /work
    # Identity is set inside the repo, not --global: a shared --global would be
    # a write to the image's home and would not survive a rebuild.
    git -C /work config user.email "agent@cod.local"
    git -C /work config user.name "cod agent"
    git -C /work config commit.gpgsign false
    log "initialised a git repository in /work for per-job worktrees"
  else
    log "existing git repository in /work, leaving it alone"
  fi

  # A worktree needs a BASE REF, and `git worktree add` against a repository
  # with no commits fails with "fatal: invalid reference: HEAD" - measured,
  # not theoretical. `git init` alone leaves HEAD pointing at a branch with
  # nothing on it, so every job failed to acquire a worktree and the whole
  # isolation design silently did nothing.
  #
  # Idempotent, and keyed on the COMMIT rather than on .git existing: a volume
  # that has a repository but no commits is exactly the broken state above, and
  # checking only for the directory would skip the repair.
  # The per-job AGENTS.md is generated into every worktree. It is the agent's
  # instructions, not the agent's work, and an agent told to "commit your work"
  # with `git add -A` committed it - so every landed branch carried an
  # instruction file into the base. Excluded in the shared info/exclude, which
  # every worktree reads. Idempotent: added once.
  if ! grep -qx 'AGENTS.md' /work/.git/info/exclude 2>/dev/null; then
    mkdir -p /work/.git/info
    printf 'AGENTS.md\n' >> /work/.git/info/exclude
    log "excluded the generated AGENTS.md from commits"
  fi

  if ! git -C /work rev-parse --verify HEAD >/dev/null 2>&1; then
    # An empty first commit, so there is something to branch from. `.cod-repo`
    # is the marker that says "this volume is a cod work volume", not content.
    printf 'cod work volume\n' > /work/.cod-repo
    git -C /work add -A
    git -C /work commit -q -m "cod: initialise the work volume"
    log "created the base commit per-job worktrees branch from"
  else
    log "work volume already has a base commit, leaving it alone"
  fi
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

# Become the supervisor, as PID 1.
#
# `exec` REPLACES this shell, so the supervisor becomes the container's main
# process. That is what makes two things true at once:
#
#   - `cod up` alone produces a working schedule (no second command)
#   - when the supervisor dies, the container dies with it, and Docker's
#     --restart policy brings both back
#
# The earlier `tail -f /dev/null` kept the container "up" indefinitely with
# nothing running inside it, so a dead supervisor was indistinguishable from a
# healthy one. `cod status` had to carry the whole burden of telling them
# apart. Making the container's life BE the schedule's life is more honest than
# detecting the difference after the fact.
log "starting the supervisor as PID 1"
exec cod-supervisor
