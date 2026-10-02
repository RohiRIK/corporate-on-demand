#!/bin/sh
# Credential shapes in what is tracked, or in what a range of commits added.
#
#   sh scripts/secret-scan.sh          # every tracked file, as it is now
#   sh scripts/secret-scan.sh A..B     # every line any commit in A..B added
#
# The range form exists because the tree form sees only the tip: a secret
# committed and then deleted in a later commit is gone from the tree and still
# in the history the push publishes.
#
# The patterns are src/redact.ts's credential shapes, so what CI refuses to
# publish and what the runtime redacts are one list. They drifted once - the
# scan knew three shapes while redaction knew seven, so a Google key, a Slack
# token, a fine-grained GitHub token or a private key went straight through it.
# tests/secretscan.test.ts holds one sample of each, and fails if this misses one.
set -eu

PATTERN='sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----'

range="${1:-}"

# Files that legitimately CONTAIN a credential shape: the redaction patterns
# themselves, the tests that prove redaction and the reviewer's leak check work
# (a test that proves a scanner catches a secret has to contain one, and these
# fixtures are visibly fake), and the checksum script. Listed one by one rather
# than globbed, so a new one cannot slip in unnoticed.
set -- . \
  ':!bun.lock' \
  ':!docs/SECURITY_POSTURE.md' \
  ':!src/redact.ts' \
  ':!tests/redact.test.ts' \
  ':!tests/results.test.ts' \
  ':!tests/review.test.ts' \
  ':!tests/land.test.ts' \
  ':!scripts/vendor-opencode.sh'

if [ -z "$range" ]; then
  if git grep -nIE "$PATTERN" -- "$@"; then
    echo "::error::possible credential in a tracked file" >&2
    exit 1
  fi
  echo "no credential shapes in tracked files"
  exit 0
fi

# Only ADDED lines: a removal of a secret is the fix, not the leak.
if git log -p --no-color --format='commit %H' "$range" -- "$@" | grep -nE "^\+.*($PATTERN)"; then
  echo "::error::possible credential added in $range" >&2
  exit 1
fi
echo "no credential shapes added in $range"
