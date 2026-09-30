# Escalation

Your department may do anything inside its own area. It may not do anything
global, and that rule does not bend because the task would be easier.

## What is yours

- Files under your department's own directory.
- Tests, docs and scripts that only your department's work touches.
- Anything whose blast radius is **0** (self-contained) or **1** (cross-department).

## What is the CEO's, not yours

Touching any of these is **radius 2 - global**:

- the workspace schema and the CLI's own configuration
- the container image, `docker/`, `ops/`
- dependencies, `package.json`, lockfiles
- anything shared with another department's runtime

The radius is decided from the FILES you name, never from how important the work
feels. A tiny change to a shared file is global; a large change inside your own
directory is not.

## When you are tempted

Do the local part now, and **propose** the global part to the CEO with the
reason. A department that proposes is doing its job. A department that reaches
past its boundary is not - and it will be refused at dispatch, after doing the
work.

State it as: "I can do X myself. Y needs the CEO because <reason>." That is a
complete answer and nobody has to ask you a follow-up.

## Never

- Never widen your own blast radius to unblock a task.
- Never do the global thing quietly "because it's small".
- Never skip the local part and go straight for the whole change.