# Traps

Each of these cost real time here. Every one of them looked fine until it did
not, and several looked fine **because** the failure was invisible.

## The silent wrong-success

An agent was given no instructions at all, and still completed the task, because
the model was capable enough to guess what was being asked. The job exited 0,
produced a plausible answer, and was recorded as a success.

This is the central failure. **The output being right is not evidence the work
was directed.** It is the same trap as asking a job to reply with a marker
phrase and grepping for it: a check against a self-report passes against a job
that did nothing.

Two fixes, and the second is the one people skip: refuse to dispatch an empty
or trivial prompt, and require a completed tool.

## The verdict nobody reads

The assertion correctly produced `agent FAILED: ...` for a genuine provider
outage. The recorder then wrote `ok: true` anyway, because `ok` had meant "the
job settled" and a failed job settles.

It surfaced only by reading the raw stored record instead of the pretty printed
line. **A display you do not read is not a check.**

## Reading docs instead of running the binary

I stripped a flag from one engine's command because `--help` did not list it,
and encoded that belief in a test with a comment saying the flag was rejected.

That engine has the flag, **needs** it, and does not document it. Without it
every tool call was auto-rejected: the run did nothing and reported success.

Lesson: a flag's absence from `--help` is evidence about the help text, not
about the CLI. Run the command.

## The build that passes and the container that dies

`bun add --global` defaults to the current user's home. During a Docker build
that is `/root`, so the symlink into it works and **the build passes**. The
container then runs as an unprivileged uid, cannot traverse `/root`, and every
invocation dies with "Permission denied".

Verify as the user that will actually run it.

## Missing interpreter, present package

An npm CLI whose bin is a Node shim installs cleanly and then fails with
`env: 'node': No such file or directory` in an image that ships no Node. The
package is fine; the interpreter assumption is not.

## Flags that behave differently on a directory

`--dir <git worktree>` failed with an opaque provider-side error while the
identical command with the process `cd`-ed into the same directory worked. The
confinement became the spawn's working directory instead.

## Default timeouts silently gutting live tests

The test runner's default per-test timeout was **5 seconds**. The live model test
did real network I/O taking 5-15 seconds. It passed only when a container
happened to be absent (early return) or the provider happened to answer fast.

A live test on the default budget is a coin flip wearing a checkmark. Give it an
explicit, generous timeout, and make its skip behaviour honest: distinguish
*the runtime is missing from the image* (our bug, fail the build) from *the
provider is unavailable* (skip, loudly).

## Free tiers rot per model, not per provider

The same provider served healthy and broken models at the same time. Pinning
one model and blaming "the provider" is how reliability stays low while
rotation sits unused in a design document.

Measure per model, rotate, and eject a model on **consecutive** failures rather
than a single blip.

## Same engine does not mean same behaviour

The two engines available here are one a fork of the other. They share flags and
almost share docs, and they still differ in where they store logs and in what
they do with a directory flag.

Running both buys a **health signal**, not independence. Say which one you have,
or the architecture will be believed to be more diverse than it is.
