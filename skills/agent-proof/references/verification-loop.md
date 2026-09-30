# The verification loop

The order matters. Each step is cheap, and stopping early is how a real bug
reaches production wearing a green build.

## 1. Red first

Write the failing test and watch it fail for the **right reason**. A test that
fails on a missing module has not proven the behaviour; it has proven the file
does not exist yet.

## 2. Green

Implement the minimum. Run the whole suite, not just the new test.

## 3. Mutation-check every new rule

Delete each rule, run the suite, confirm failures. Record the counts.

```sh
cp src/assert.ts /tmp/assert.bak
# flip one rule to `if (false) {`, run the suite, restore
bun test ./tests/assert.test.ts ./tests/agent.test.ts
cp /tmp/assert.bak src/assert.ts
```

No failures means the rule is decorative. Delete it or write the test that
detects it.

## 4. Confirm the recorder reads the verdict

Run a **failing** job end to end and read the stored result record, not the
summary line. A correct verdict that is recorded as a success has changed
nothing.

## 5. Rebuild the image, in the image

Code changes need the image rebuilt before any live test means anything. A
container running the previous image will pass or fail for the previous reason,
which is worse than not testing.

```sh
docker build -f docker/Dockerfile.sandbox -t cod-sandbox:test .
docker run --rm --entrypoint sh --user 1000:1000 cod-sandbox:test -lc '<the real command>'
```

`--entrypoint sh` matters: the image's entrypoint takes over PID 1 and your
command never runs.

## 6. Live, credential-free, as the runtime user

```sh
scripts/agent-proof/probe-live.sh <engine> <model> <n>
```

Reports answers, streams truncated, and provider failures. Compare engines on
the **same** prompt in the same image; a comparison across days is not a
comparison.

## 7. Prove it in the product

A unit test on the driver is not the feature. Run the real scheduled path and
read what the operator will read:

```sh
cod results
```

It must show the changed files. A job that changed nothing must not look like a
job that worked.

## 8. Gates, clean room, push

```sh
./node_modules/.bin/tsc --noEmit
bun test ./tests
sh verify.sh
sh scripts/cleanroom.sh /tmp/cod-verify     # fresh clone, deleted image
```

Clean-room is the one that catches packaging bugs, because it rebuilds the
image from nothing and runs as the unprivileged user.

## 9. Record what you did not prove

Write down what the change does **not** establish, in the same commit. Small
samples are not benchmarks; "did not reproduce" is not "fixed"; a rotated pool
is not a reliable one.
