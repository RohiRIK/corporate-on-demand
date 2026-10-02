#!/bin/sh
# The end-to-end check, from an empty directory to a working container.
#
#   sh scripts/cleanroom.sh [DIR]
#
# Deliberately does not reuse anything: a fresh state dir, a fresh workspace,
# a fresh container, and no cached image. The point is to prove a new user can
# go from nothing to a running agent without a manual step, so any state that
# made it work on the second run would be exactly the thing this is meant to
# catch.
#
# COD_CLEANROOM_IMAGE=<tag> runs every phase against an image that already
# exists instead of building one - for a host that cannot reach the package
# mirrors the build needs. The build phase is then reported as NOT checked, and
# the result line says so: a run that skipped the build has not proved it.
#
# Exit 0 only if every phase that ran passed. A partial pass is a failure.

set -eu

# The CLI is found from this script's own location. It was a hardcoded path on
# one developer's machine, so on any other machine every step "failed" with
# nothing to do with the code under test.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO/src/index.ts"
cod() { bun "$CLI" "$@"; }

ROOT="${1:-/tmp/cod-cleanroom}"
PREBUILT="${COD_CLEANROOM_IMAGE:-}"
FAILED=0
NOT_CHECKED=""

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }
skip() { printf '  SKIP  %s\n' "$1"; NOT_CHECKED="${NOT_CHECKED:+$NOT_CHECKED; }$1"; }
step() { printf '\n== %s ==\n' "$1"; }

for tool in bun docker jq; do
  command -v "$tool" >/dev/null 2>&1 || { printf 'cleanroom needs %s on PATH\n' "$tool"; exit 1; }
done

# Never inherit a polluted shell: this is the trap that made the suite fail
# once already.
unset COD_WORKSPACE COD_STATE_DIR COD_IMAGE 2>/dev/null || true

printf 'clean room: %s\n' "$ROOT"
rm -rf "$ROOT"
mkdir -p "$ROOT"
export COD_WORKSPACE="$ROOT/cod.json"
export COD_STATE_DIR="$ROOT/state"
if [ -n "$PREBUILT" ]; then
  export COD_IMAGE="$PREBUILT"
  printf 'image: %s (prebuilt - the build phase will NOT be checked)\n' "$PREBUILT"
fi

# Whatever happens, leave nothing behind: the container, the work volume and
# the directory. `cod down` keeps the volume on purpose, so a throwaway
# workspace has to purge it or every run leaves one for ever.
cleanup() {
  if [ -f "$ROOT/cod.json" ]; then
    cod down >/dev/null 2>&1 || true
    cod purge --purge >/dev/null 2>&1 || true
  fi
  rm -rf "$ROOT" 2>/dev/null || true
}
trap cleanup EXIT

# The container name is DERIVED from the workspace path, the way the CLI does
# it, never hardcoded: a hardcoded name is exactly what once hid a
# path-derivation bug, because the script kept passing against the one
# workspace whose name happened to match. --json, because the human-readable
# form is two lines.
CONTAINER="$(cod container-name --json 2>/dev/null | jq -r '.container // empty' || true)"
if [ -z "$CONTAINER" ]; then
  fail "could not determine the container name for $COD_WORKSPACE"
  exit 1
fi

step "1. doctor - the host can run a container"
if cod doctor >/dev/null 2>&1; then pass "docker is available"; else fail "doctor"; fi

step "2. init - onboarding from nothing"
if cod init acme --yes >/dev/null 2>&1; then pass "workspace written"; else fail "init"; fi
[ -f "$ROOT/cod.json" ] && pass "cod.json exists" || fail "cod.json missing"
if cod init again --yes >/dev/null 2>&1; then
  fail "a second init overwrote the workspace"
else
  pass "a second init is refused rather than overwriting"
fi

step "3. the workspace is valid and secret-free"
if cod config show --json 2>/dev/null | jq -e . >/dev/null; then pass "config parses"; else fail "config"; fi
if jq -e '[paths(scalars) as $p | select(($p|join("."))|test("key|token|secret|password";"i"))] | length == 0' "$ROOT/cod.json" >/dev/null; then
  pass "no secret-shaped fields in cod.json"
else
  fail "cod.json contains a secret-shaped field"
fi

step "4. the image builds from a clean cache"
if [ -n "$PREBUILT" ]; then
  if docker image inspect "$PREBUILT" >/dev/null 2>&1; then
    skip "the image build (COD_CLEANROOM_IMAGE=$PREBUILT)"
  else
    fail "COD_CLEANROOM_IMAGE=$PREBUILT does not exist"
  fi
elif cod image --rebuild --json 2>/dev/null | jq -e '.outcome == "built"' >/dev/null; then
  pass "image built from scratch"
else
  fail "image build"
fi

step "5. up - the container starts, and its supervisor is live"
if cod up --json 2>/dev/null | jq -e '.started and .liveness == "live"' >/dev/null; then
  pass "container started with a live supervisor"
else
  fail "up"
fi
if cod supervise --json 2>/dev/null | jq -e '.running and .liveness == "live"' >/dev/null; then
  pass "cod supervise reads it, read-only"
else
  fail "cod supervise"
fi
PID1="$(docker exec "$CONTAINER" sh -c 'tr "\0" " " </proc/1/cmdline' 2>/dev/null || true)"
case "$PID1" in
  *supervisor*) pass "the supervisor is PID 1" ;;
  *) fail "PID 1 is not the supervisor: $PID1" ;;
esac

step "6. the security posture is real, not decorative"
INS=$(docker inspect "$CONTAINER" --format '{{json .HostConfig}}')
MOUNTS=$(docker inspect "$CONTAINER" --format '{{json .Mounts}}')
check() {
  if printf '%s' "$1" | jq -e "$2" >/dev/null 2>&1; then pass "$3"; else fail "$3"; fi
}
check "$INS" '.CapDrop | index("ALL") != null' "capabilities dropped (ALL)"
check "$INS" '.SecurityOpt | index("no-new-privileges") != null' "no-new-privileges set"
check "$INS" '.PidsLimit != null and .PidsLimit > 0' "PID limit set"
check "$INS" '.Memory != null and .Memory > 0' "memory limit set"
# .Mounts, not .HostConfig.Binds: cod mounts with --mount, which Binds never
# lists, so a check on Binds passed whatever was mounted.
check "$MOUNTS" '[.[].Destination] | sort == ["/cod", "/cod/cod.json", "/work"]' "exactly the three expected mounts"
check "$MOUNTS" 'map(select(.Destination == "/cod/cod.json")) | .[0].RW == false' "the workspace file is read-only"
check "$MOUNTS" 'map(select(.Destination == "/work")) | .[0].Type == "volume"' "/work is a named volume, not a host path"
# Bind sources only: a named volume's own source is under /var/lib/docker by
# definition, and is not a host path anyone handed over.
check "$MOUNTS" 'map(select(.Type == "bind") | .Source | test("\\.sock$|/run/docker|/var/lib/docker|/run/containerd")) | any | not' "no container runtime socket or directory is bind-mounted"

step "7. agents are confined by the kernel"
PROBE="$(docker exec "$CONTAINER" cod-sandbox --probe 2>&1 || true)"
case "$PROBE" in
  "landlock abi "*) pass "landlock is available ($PROBE)" ;;
  *) fail "landlock is not available: $PROBE" ;;
esac
STATUS="$(cod status --json 2>/dev/null || true)"
[ -n "$STATUS" ] || STATUS='{}'
check "$STATUS" '(.sandbox // "") | startswith("on ")' "the supervisor reports agents sandboxed"
# The positive control first: the same rules DO allow what they name, so the
# refusal below is the sandbox and not a missing binary.
SBX='cod-sandbox --ro /usr --ro /bin --ro /lib --ro /lib64 --ro /etc --rw /tmp --'
if docker exec "$CONTAINER" sh -c "$SBX cat /etc/hostname" >/dev/null 2>&1; then
  pass "a sandboxed process reads what it was granted"
else
  fail "the sandbox refused even what it was granted"
fi
DENIED="$(docker exec "$CONTAINER" sh -c "$SBX cat /cod/cod.json" 2>&1 || true)"
case "$DENIED" in
  *"Permission denied"*) pass "a sandboxed process cannot read /cod, where the ledger lives" ;;
  *) fail "a sandboxed process read /cod: $DENIED" ;;
esac
DENIED="$(docker exec "$CONTAINER" sh -c "$SBX sh -c 'echo x > /work/planted'" 2>&1 || true)"
case "$DENIED" in
  *"Permission denied"*) pass "a sandboxed process cannot write the main checkout" ;;
  *) fail "a sandboxed process wrote /work: $DENIED" ;;
esac

step "8. an agent answers from inside the sandbox, with no credentials"
# Through cod-sandbox, with a role's policy - the system read-only, scratch
# and HOME writable, /cod and /work invisible - because that is how every
# agent runs now. And an ARITHMETIC question: the old check asked for a word
# and grepped for it, which passes on anything that echoes the prompt - an
# error message quoting it, say. 391 appears nowhere in the question.
#
# The free model endpoint fails intermittently ("Unexpected server error").
# Measured: 1 failure in 3 identical calls. A check that dies on a provider
# blip trains you to ignore it, so retry - but keep failing after the
# retries, because a deterministic regression would survive them too.
AGENT='set -e
scratch="$(mktemp -d)"
cd "$scratch"
exec cod-sandbox --ro /usr --ro /bin --ro /sbin --ro /lib --ro /lib64 --ro /etc --ro /opt --ro /proc --ro /sys --ro /var \
  --rw /tmp --rw /dev --rw "$HOME" --rw "$scratch" \
  -- opencode run --pure --auto --format json -m opencode/space-bunny-free --title cleanroom \
  "What is 17 multiplied by 23? Reply with the number only."'
AGENT_OUT=""
ANSWER=""
attempt=1
while [ "$attempt" -le 3 ]; do
  AGENT_OUT="$(docker exec "$CONTAINER" sh -c "$AGENT" 2>&1 || true)"
  ANSWER="$(printf '%s\n' "$AGENT_OUT" | jq -Rr 'fromjson? | select(.type == "text") | .part.text' 2>/dev/null | tr -d '[:space:]')"
  if printf '%s' "$ANSWER" | grep -Eq '(^|[^0-9])391([^0-9]|$)'; then
    pass "a sandboxed agent answered correctly (attempt $attempt): $ANSWER"
    break
  fi
  printf '  ....  no correct answer (got "%s"), retrying (%s/3)\n' "$ANSWER" "$attempt"
  attempt=$((attempt + 1))
  sleep 3
done
if [ "$attempt" -gt 3 ]; then
  fail "the agent did not answer in 3 attempts: $(printf '%s' "$AGENT_OUT" | tail -c 400)"
fi
# Checked on the attempt that succeeded, so a blip cannot mask a cost
# regression: every step must report a cost, and every cost must be zero.
COSTS="$(printf '%s\n' "$AGENT_OUT" | jq -Rr 'fromjson? | select(.type == "step_finish") | .part.cost' 2>/dev/null || true)"
if [ -n "$COSTS" ] && ! printf '%s\n' "$COSTS" | grep -vqx '0'; then
  pass "the call cost nothing"
else
  fail "cost was not zero, or not reported: $(printf '%s' "$COSTS" | tr '\n' ' ')"
fi
if docker exec "$CONTAINER" sh -c 'test ! -e "$HOME/.local/share/opencode/auth.json" && test ! -e "$HOME/.local/share/kilo/auth.json"' \
  && [ ! -e "$ROOT/state/auth.json" ]; then
  pass "no credential was written to disk"
else
  fail "a credential appeared on disk"
fi

step "9. the runtime is the pinned one"
check_runtime() {
  if [ "$(docker exec "$CONTAINER" "$1" --version 2>&1 | head -1)" = "$2" ]; then
    pass "$1 $2"
  else
    fail "$1 is not $2"
  fi
}
check_runtime bun 1.3.12
check_runtime opencode 1.18.31

step "10. down - and it leaves nothing behind"
if cod down --json 2>/dev/null | jq -e . >/dev/null; then pass "down reported cleanly"; else fail "down"; fi
# This workspace's container, by its derived name - not every container
# whose name contains "cod-sandbox", which another workspace on the same host
# would fail for.
if [ -z "$(docker ps -a --filter "name=^${CONTAINER}\$" --format '{{.Names}}')" ]; then
  pass "no container left behind"
else
  fail "the container survived down"
fi

step "11. down is idempotent"
if cod down >/dev/null 2>&1; then pass "a second down is a no-op"; else fail "down is not idempotent"; fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  if [ -n "$NOT_CHECKED" ]; then
    printf 'RESULT: PASS, but NOT checked: %s\n' "$NOT_CHECKED"
  else
    printf 'RESULT: PASS (%s)\n' "$ROOT"
  fi
  exit 0
fi
printf 'RESULT: FAIL (%s)\n' "$ROOT"
exit 1
