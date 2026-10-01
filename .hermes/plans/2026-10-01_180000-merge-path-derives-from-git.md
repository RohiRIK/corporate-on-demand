# Make the merge path derive its facts from git, not from strings

**Date:** 2026-10-01 · **Repo:** `corporate-on-demand` · **Branch:** `main`
**Authority:** `/plan` approved. Execute fully; report once.

## Goal

Fix the five findings that mean Stages 4–5 are built but unproven, so the company can actually land work.

## Context

Stage 4 (review and merge) and Stage 5 (runs itself) are marked DONE. Nothing has
ever merged. Two reviews found why, all in `land.ts`:

1. `git diff master...${branch}` — **base branch hardcoded.** Reproduced:
   `fatal: ambiguous argument 'master...agent': unknown revision`. On a `main`
   repo this returns null → `landWork` reports **`skipped`**, not failed. The
   loop looks healthy while landing nothing. **This is the most likely reason
   nothing has ever merged.**
2. The global-path check reads only `+++ b/<path>` from diff text. A deletion
   emits `+++ /dev/null`; a rename emits no `+++` at all. Reproduced:
   `git rm verify.sh` → **`landed`**.
3. `targetPaths` is unvalidated, and it is what derives the blast radius — so the
   agent supplies the list that decides whether the CEO is involved.
4. `core.hooksPath=/dev/null` guards the **merge** only. `git diff` at
   `land.ts:111`, `change.ts:25`, `landing.ts:25`, `worktree.ts:35` is unguarded,
   so a `.gitattributes` filter driver on the reviewed branch runs at diff time.
5. `ok` is derived from exit status and stream shape, never from whether anything
   changed. An agent that commits nothing records `ok: true`.

### The one root cause

Three of these are the same mistake: **`land.ts` decides the merge base, reads
the changed paths, and trusts the declared radius — from strings and from the
proposer's word — instead of asking git.** `src/change.ts` already does it
correctly and is used by `supervisor.ts:349`. The one module that merges does not
use it.

## Approach

Make `land.ts` derive all three facts from git by construction, and treat the
text scan as a second net rather than the only one. Tasks are ordered so each is
independently verifiable and independently valuable.

**Deferred, not in scope:** SEC-03 (an agent can read the ledger). It needs a host
`sudo chown` and a container uid split. **Gate: do not run `cod up` unattended
until it is done.**

---

## Task 1 — the base branch is a fact, not a constant

`src/change.ts` and `src/land.ts` both hardcode `master`.

- Test: a repo initialised with `git init -b main` still lands. RED first.
- Implement: `resolveBase(repo)` — try `refs/remotes/origin/HEAD`, then the
  current `HEAD`'s own branch, then `master`, then `main`. One helper, used by
  both files.
- Verify: the whole `land` suite plus a `main`-based fixture.

## Task 2 — changed paths come from `--name-status`

- Test: `git rm` of a global file, and `git mv` out of a global path, both
  refused — asserted through `landWork` against a real repo, checking master's
  tree afterwards, not just the verdict string.
- Implement: `git diff --name-status -z master...branch`, feed **both** sides of
  a rename to `classifyChange`. Keep `mechanicalChecks` on the text for secrets
  and forbidden actions; refuse binaries outright, since they produce no
  reviewable lines.
- This is what makes Max's finding 3 moot: `boundary.ts` finally runs on the
  merge path.

## Task 3 — the radius is derived, never declared

- Test: an item declaring radius 0 whose diff touches a global path is refused.
- Implement: use the derived radius on the merge path. A declared radius may only
  ever narrow the derived one — already true in `radiusForWork`, so this is
  mostly wiring.

## Task 4 — the diff commands are guarded too

- Test: a branch carrying a `.gitattributes` filter driver cannot execute it at
  diff time.
- Implement: pass `-c core.hooksPath=/dev/null -c core.attributesFile=/dev/null`
  and `--no-ext-diff` to every git invocation that reads a **branch's** content,
  not just the merge.

## Task 5 — changed nothing is not success

- Test: an agent that exits 0, streams a well-formed answer and commits zero
  files is **refused with a demand**, not recorded `ok: true`.
- Implement: couple `ok` to `commitCount > 0` for mutating jobs (`expectTools`),
  and route the refusal through the same review loop so it gets a fix demand.

## Task 6 — mutation-verify, document, gate

Every guard must fail the suite when broken. Then `verify.sh`, clean-room, and a
live run to see a **real merge** for the first time.

---

## Risks

- Task 2 changes what gets refused; existing fixtures may assume the old text-only
  behaviour. Expect failures that are the fix working.
- `--name-status -z` needs careful parsing; a malformed entry must refuse, not
  pass.
- Binary refusal is new and will reject legitimate binary work. That is intended:
  an unreviewable change is not an approved change.

## Out of scope

SEC-03; systemd boot enablement; pointing `landing.repo` at a real remote;
running the company unattended.