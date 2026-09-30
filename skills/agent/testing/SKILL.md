# Testing

How to check work in this repository. Read this before claiming something works.

## The gates

Run all three before committing. `verify.sh` runs the first two for you.

```sh
bun test ./tests                    # the suite
./node_modules/.bin/tsc --noEmit    # strict typecheck
sh verify.sh                        # typecheck + tests + build inputs + shell syntax
```

## Use the local tsc, never `bun x tsc`

`bun x` re-enters the package-resolution path even though typescript is already
a devDependency and its binary is sitting in `node_modules/.bin`. That is slow,
non-deterministic offline, and it triggers a security scanner that can block the
run on a network timeout. This has stalled work here three times.

## What a green suite does and does not mean

A test that cannot fail is not evidence. Before you trust a test:

1. Break the code it guards.
2. Run it.
3. Confirm the test fails.
4. Restore the code.

If the test still passes, the test is decoration — delete it or fix it.

## Writing a test

- Test the property, not the implementation. "Never exceeds the limit", not
  "calls the limiter".
- One behaviour per test, named as the behaviour: `"a stale commit is refused"`.
- If a test needs a real subprocess, spawn it **asynchronously**. `spawnSync` in
  a loop runs the processes one after another, and a test labelled "REAL
  CONCURRENCY" that does that proves nothing.
- Anything touching Docker or a model is slow and flaky. Keep the pure logic in
  unit tests and make the live check a small, skippable, clearly-named one.

## The clean-room

`sh scripts/cleanroom.sh /tmp/somewhere` builds the image from a clean cache and
exercises a real job end to end. It is a human-triggered check, not part of
`verify.sh`, because it needs Docker and a free model endpoint that has failed
intermittently. A build that goes red when a provider has a bad afternoon is a
build people learn to ignore.
