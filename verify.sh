#!/bin/sh
# The project's verification entry point.
#
# Exits non-zero on any failure, so CI and `make check` can gate on it.
#
# Layers, cheapest first: typecheck, then unit tests. The container checks are
# NOT run here by default - they need Docker, take minutes to build, and hit a
# network. Run them explicitly with:
#
#   sh scripts/cleanroom.sh /tmp/cod-verify
#
# The distinction matters: a script that silently skips its own hardest tests
# is worse than one that does not claim to run them.

set -eu

# verify.sh lives at the repository root, so ROOT is its own directory. Using
# dirname/.. here (the usual subdirectory layout) resolves to the PARENT of the
# repo, and every check below then silently reports the wrong files as missing.
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

FAILED=0
step() { printf '\n== %s ==\n' "$1"; }
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }

# A polluted shell must not decide whether the suite passes. COD_WORKSPACE and
# COD_STATE_DIR are read by the CLI, and an inherited value silently redirects
# where the tests write.
unset COD_WORKSPACE COD_STATE_DIR COD_IMAGE 2>/dev/null || true

step "typecheck"
# Use the typechecker already installed in node_modules, not `bun x`.
#
# `bun x` goes through the package-resolution path even though typescript is
# already a devDependency and its binary is sitting right there in
# node_modules/.bin. That is slow, it is non-deterministic when offline, and -
# the reason this changed - it looks to a security scanner like a new package
# is being fetched, which triggers a network threat-intelligence lookup. That
# lookup times out on a slow link and BLOCKS the run. Three separate stalls
# traced back to this one line.
#
# The fallback keeps the script working in a checkout with no node_modules
# (a fresh clone before `bun install`), where there is genuinely nothing local
# to use.
if [ -x node_modules/.bin/tsc ]; then
  tsc_cmd="node_modules/.bin/tsc"
else
  tsc_cmd="bun x tsc"
fi

if $tsc_cmd --noEmit; then
  pass "$tsc_cmd --noEmit"
else
  fail "tsc reported type errors"
fi

step "unit tests"
if bun test ./tests; then
  pass "bun test"
else
  fail "tests failed"
fi

step "the vendored opencode binary"
if [ -x vendor/opencode/1.18.31/opencode ]; then
  pass "vendored ($(vendor/opencode/1.18.31/opencode --version))"
else
  fail "opencode is not vendored - run: sh scripts/vendor-opencode.sh"
fi

step "build inputs"
for f in docker/Dockerfile.sandbox docker/entrypoint.sh docker/sandbox.c scripts/cleanroom.sh ops/cod-workspace@.service; do
  if [ -f "$f" ]; then pass "$f"; else fail "$f is missing"; fi
done

step "shell syntax"
for s in scripts/cleanroom.sh scripts/vendor-opencode.sh scripts/secret-scan.sh docker/entrypoint.sh; do
  if sh -n "$s" 2>/dev/null; then pass "$s"; else fail "$s does not parse"; fi
done

step "secret scan"
# The same scan CI runs before anything is published.
if sh scripts/secret-scan.sh >/dev/null; then
  pass "no credential shapes in tracked files"
else
  fail "a tracked file holds a credential shape - run: sh scripts/secret-scan.sh"
fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf 'verify.sh: PASS\n'
  printf 'container checks were NOT run - use scripts/cleanroom.sh for those\n'
  exit 0
fi
printf 'verify.sh: FAIL\n'
exit 1
