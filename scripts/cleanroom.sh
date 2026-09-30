#!/bin/sh
# The end-to-end check, from an empty directory to a working container.
#
# Deliberately does not reuse anything: a fresh state dir, a fresh workspace,
# a fresh container, and no cached image. The point is to prove a new user can
# go from nothing to a running agent without a manual step, so any state that
# made it work on the second run would be exactly the thing this is meant to
# catch.
#
# Exit 0 only if every phase passes. A partial pass is a failure.

set -eu

CLI="/home/rohi/homelab/projects/corporate-on-demand/src/index.ts"
ROOT="${1:-/tmp/cod-cleanroom}"
FAILED=0

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }
step() { printf '\n== %s ==\n' "$1"; }

# Never inherit a polluted shell: this is the trap that made the suite fail
# once already.
unset COD_WORKSPACE COD_STATE_DIR COD_IMAGE 2>/dev/null || true

printf 'clean room: %s\n' "$ROOT"
rm -rf "$ROOT"
mkdir -p "$ROOT"
export COD_WORKSPACE="$ROOT/cod.json"
export COD_STATE_DIR="$ROOT/state"

# The container name is DERIVED from the workspace path, not hardcoded.
#
# It used to be hardcoded as `cod-sandbox-cod`, which was correct only while the
# name came from the workspace file's basename and every workspace was called
# cod.json. Deriving it from the same place the CLI does means this script can
# never drift from the real behaviour again - and a hardcoded name is exactly
# what hid the path-derivation bug, because the script kept passing against the
# one workspace whose name happened to match.
# --json, because the human-readable form is TWO lines (container and volume)
# and command substitution would capture both.
CONTAINER="$("$CLI" container-name --json 2>/dev/null | jq -r '.container // empty' || true)"
if [ -z "$CONTAINER" ]; then
  # No such subcommand, or the JSON shape changed: fall back to the one
  # container labelled for this workspace file, which is the property that
  # actually matters - not any particular name.
  CONTAINER="$(docker ps -q --filter "label=cod.workspace=$COD_WORKSPACE" | head -1)"
fi
if [ -z "$CONTAINER" ]; then
  fail "could not determine the container name for $COD_WORKSPACE"
  exit 1
fi

step "1. doctor - the host can run a container"
if "$CLI" doctor >/dev/null 2>&1; then pass "docker is available"; else fail "doctor"; fi

step "2. init - onboarding from nothing"
if "$CLI" init acme --yes >/dev/null 2>&1; then pass "workspace written"; else fail "init"; fi
[ -f "$ROOT/cod.json" ] && pass "cod.json exists" || fail "cod.json missing"

step "3. the workspace is valid and secret-free"
if "$CLI" config show --json 2>/dev/null | jq -e . >/dev/null; then pass "config parses"; else fail "config"; fi
if jq -e '[paths(scalars) as $p | select(($p|join("."))|test("key|token|secret|password";"i"))] | length == 0' "$ROOT/cod.json" >/dev/null; then
  pass "no secret-shaped fields in cod.json"
else
  fail "cod.json contains a secret-shaped field"
fi

step "4. the image builds from a clean cache"
if "$CLI" image --rebuild --json 2>/dev/null | jq -e '.outcome == "built"' >/dev/null; then
  pass "image built from scratch"
else
  fail "image build"
fi

step "5. up - the container starts"
if "$CLI" up --json 2>/dev/null | jq -e '.started' >/dev/null; then pass "container started"; else fail "up"; fi

step "6. the security posture is real, not decorative"
INS=$(docker inspect "$CONTAINER" --format '{{json .HostConfig}}')
check_flag() {
  if printf '%s' "$INS" | jq -e "$1" >/dev/null 2>&1; then pass "$2"; else fail "$2"; fi
}
check_flag '.CapDrop | index("ALL") != null' "capabilities dropped (ALL)"
check_flag '.SecurityOpt | index("no-new-privileges") != null' "no-new-privileges set"
check_flag '.PidsLimit != null and .PidsLimit > 0' "PID limit set"
check_flag '.Memory != null and .Memory > 0' "memory limit set"
if printf '%s' "$INS" | jq -e '[.Binds[]?] | length == 0' >/dev/null 2>&1; then
  pass "no host binds"
else
  # A mount of /cod is expected; the forbidden one is the docker socket.
  if printf '%s' "$INS" | jq -e '[.Binds[]?] | map(test("docker.sock")) | any' >/dev/null 2>&1; then
    fail "the docker socket is mounted into the sandbox"
  else
    pass "no docker socket mounted"
  fi
fi

step "7. the agent really runs inside it, with no credentials"
# The free model endpoint fails intermittently ("Unexpected server error").
# Measured: 1 failure in 3 identical calls, with the same container and the
# same image. A check that dies on a provider blip trains you to ignore it, so
# retry - but keep failing after the retries, because a genuine regression here
# would also survive a handful of attempts if it were deterministic.
AGENT_OUT=""
attempt=1
while [ "$attempt" -le 3 ]; do
  AGENT_OUT=$(docker exec "$CONTAINER" sh -lc \
    'cd /work && opencode run --pure --format json -m opencode/space-bunny-free "reply with exactly: E2E_OK" 2>&1' || true)
  if printf '%s' "$AGENT_OUT" | grep -q 'E2E_OK'; then
    pass "an agent produced work (attempt $attempt)"
    break
  fi
  printf '  ....  agent call failed, retrying (%s/3)\n' "$attempt"
  attempt=$((attempt + 1))
  sleep 3
done

if [ "$attempt" -gt 3 ]; then
  fail "agent run failed 3 times: $AGENT_OUT"
fi
# Checked against the attempt that actually succeeded, so a blip cannot mask a
# real cost regression.
if printf '%s' "$AGENT_OUT" | grep -q '"cost":0'; then
  pass "the call cost nothing"
else
  fail "cost was not zero"
fi
if [ ! -f "$ROOT/auth.json" ] && [ ! -f "$ROOT/.opencode/auth.json" ]; then
  pass "no credential was written to disk"
else
  fail "a credential appeared on disk"
fi

step "8. the runtime is the pinned one"
check_runtime() {
  if [ "$(docker exec "$CONTAINER" "$1" --version 2>&1 | head -1)" = "$2" ]; then
    pass "$1 $2"
  else
    fail "$1 is not $2"
  fi
}
check_runtime bun 1.3.12
check_runtime opencode 1.18.31

step "9. down - and it leaves nothing behind"
if "$CLI" down --json 2>/dev/null | jq -e . >/dev/null; then pass "down reported cleanly"; else fail "down"; fi
if [ -z "$(docker ps -a --filter name=cod-sandbox --format '{{.Names}}')" ]; then
  pass "no container left behind"
else
  fail "a cod container survived down"
fi

step "10. down is idempotent"
if "$CLI" down >/dev/null 2>&1; then pass "a second down is a no-op"; else fail "down is not idempotent"; fi

# The work volume is kept by `cod down` on purpose, so an agent's commits
# survive a restart. A clean-room run creates a throwaway workspace, so it must
# clean up after itself or every run leaves a volume behind for ever.
if [ -f "$ROOT/cod.json" ]; then
  "$CLI" purge --purge >/dev/null 2>&1 || true
fi
rm -rf "$ROOT" 2>/dev/null || true

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf 'RESULT: PASS (%s)\n' "$ROOT"
  exit 0
fi
printf 'RESULT: FAIL (%s)\n' "$ROOT"
exit 1
