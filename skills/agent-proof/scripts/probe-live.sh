#!/bin/sh
# Probe a free, credential-free model N times and report what actually happened.
#
# Exists because this was retyped by hand on every investigation, and because
# the three numbers it prints are the ones people get wrong by eyeballing a
# single successful call:
#
#   answered   calls that produced text
#   truncated  answered BUT the stream had no terminal completion event
#   no answer  calls that produced nothing at all
#
# TRUNCATED is the one that hides: those calls exit 0 and look perfect. It is
# the signature of the known upstream stream bug, and an assertion that ignores
# it reports them as successes.
#
# Run it INSIDE the image as the unprivileged user. On the host the binary may
# be missing, the flags may differ, and the result tells you nothing about what
# the container will do.
#
#   sh scripts/agent-proof/probe-live.sh <engine> <model> [n]
#
# Example:
#   sh scripts/agent-proof/probe-live.sh kilo kilo/kilo-auto/free 10

set -eu

ENGINE="${1:-kilo}"
MODEL="${2:-kilo/kilo-auto/free}"
COUNT="${3:-5}"
IMAGE="${COD_IMAGE:-cod-sandbox:1.3.12}"
TIMEOUT="${COD_PROBE_TIMEOUT:-90}"
PROMPT="${COD_PROBE_PROMPT:-What is 17 plus 26? Reply with only the number.}"

# `--auto` is required by every engine tried so far and documented by none of
# them. Without it every tool call is auto-rejected, which is a different
# failure from the one this script is measuring.
AUTO="--auto "

printf 'engine=%s model=%s n=%s image=%s\n' "$ENGINE" "$MODEL" "$COUNT" "$IMAGE"

answered=0
truncated=0
noanswer=0
i=1
while [ "$i" -le "$COUNT" ]; do
  out=$(docker run --rm --entrypoint sh --user 1000:1000 "$IMAGE" -lc \
    "cd /tmp && timeout $TIMEOUT $ENGINE run --pure $AUTO--format json -m '$MODEL' '$PROMPT' 2>&1 | head -c 2000" || true)

  has_text=no
  has_finish=no
  # JSONL: one event per line. Matching on the event type is deliberately crude
  # - a shell that could not parse JSON would be a second thing going wrong.
  case "$out" in *'"type":"text"'*) has_text=yes ;; esac
  case "$out" in *'"type":"step_finish"'*) has_finish=yes ;; esac

  if [ "$has_text" = yes ]; then
    answered=$((answered + 1))
    if [ "$has_finish" = no ]; then
      truncated=$((truncated + 1))
      printf '  %2d  TRUNCATED  answered with no terminal completion event\n' "$i"
      continue
    fi
    printf '  %2d  ok\n' "$i"
  else
    noanswer=$((noanswer + 1))
    # Keep a little of the reason: a bare counter sends you to the log by hand.
    printf '  %2d  NO ANSWER  %s\n' "$i" "$(printf '%s' "$out" | tr -d '\n' | cut -c1-110)"
  fi
  i=$((i + 1))
done

printf '\n  answered  %d/%d\n' "$answered" "$COUNT"
printf '  truncated %d   <- answered but the stream lost its tail\n' "$truncated"
printf '  no answer %d   <- provider failures, or the flag is missing\n' "$noanswer"

if [ "$truncated" -gt 0 ]; then
  printf '\nWARNING: %d run(s) exited looking successful with a truncated stream.\n' "$truncated"
  printf 'Any check that only looks at the exit code is counting these as passes.\n'
fi
if [ "$noanswer" -eq "$COUNT" ]; then
  printf '\nEvery call failed. Before blaming the provider: is %s on PATH in the image,\n' "$ENGINE"
  printf 'does it need an interpreter the image lacks, and does it require --auto?\n'
  exit 1
fi
