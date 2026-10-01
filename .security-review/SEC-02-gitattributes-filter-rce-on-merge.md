# SEC-02 — Git merge can be turned into code execution via .gitattributes filter drivers (HIGH)

## Where

- `src/land.ts:184-189` — the merge
- `src/review.ts:38-53` — `mechanicalChecks`, the only pre-merge gate
- `src/docker.ts:477` — `/work` is a writable named volume, container runs as 1000:1000

## Verdict on the `-c core.hooksPath=/dev/null` guard

The hooks guard itself is **sound for hooks**. `core.hooksPath=/dev/null` does disable
`pre-merge-commit`, `post-merge`, and `prepare-commit-msg` for that invocation, and
`execFileSync` with an argv array means no shell is involved. The comment at `land.ts:174-176`
claims exactly this and the claim holds. Confirmed: **no shell anywhere in the land path**
(`git()` at `land.ts:61-71` uses `execFileSync("git", [...args])`).

That guard covers ONE vector. It does not generalise to git's other config-driven execution
paths, and one of those is reachable.

## The gap: `.gitattributes` + a filter configured in `.git/config`

`git merge` does a checkout. Checkout applies **gitattributes filters**, and which filters
exist is read from **git config**, not from the tree.

The pieces:

1. **The agent has shell and write access to `/work`.** The agent runs with `--auto`
   (`src/agent.ts`, `src/backend.ts:63,81`) — tool use granted, no human gate. Its worktree
   lives inside the `/work` named volume (`src/docker.ts:477`), mounted **read-write**, and the
   container runs as `1000:1000` (`src/docker.ts:503`, `Dockerfile.sandbox:127`).
2. **`.git/config` is not tracked by git.** No commit can modify it, so no branch can smuggle
   a filter config — but that is irrelevant, because the agent does not need a commit. It has
   a shell. It writes `filter.pwn.clean = !touch /work/PWNED` into `/work/.git/config`
   directly. It also has `git config --global` available as UID 1000
   (`Dockerfile.sandbox:145` sets a global identity; the global file is writable by that UID).
3. **The branch carries `.gitattributes`** naming that filter. This part IS tracked, so it
   travels in the diff.
4. **The merge checks the files out and runs the driver.** `git merge --no-ff` in `land.ts`
   materialises the merged tree into the working tree, invoking `filter.pwn.clean`.

The agent's shell writes and its commits are both entirely in-band for a system whose stated
threat model is "untrusted model output". Nothing between the agent and `git merge` prevents
step 2.

## Why the mechanical gate does not catch it

`mechanicalChecks` (`src/review.ts:61-84`) checks exactly three things: secret regexes on
added lines, three forbidden-action regexes (`git push`, `git merge`, `--force`), and
`isGlobalPath` on `+++ b/` header lines.

A `.gitattributes` containing:

```
* filter=pwn
```

matches none of them. It is not a secret, not a git action, not a global path. It is a
two-word text file. The reviewer model is then asked to judge it (`land.ts:131`) and is
briefed to check "scope, correctness, tests, secrets and boundary"
(`src/review.ts:95-103`) — it is explicitly *told* secrets and boundary are already decided
mechanically, so it has every reason to approve a one-line attributes file.

Note also: the step-2 config write happens in the agent's own worktree checkout, and
`git diff master...branch` (`land.ts:111`) shows only tracked content. **The `.git/config`
mutation is invisible to the diff entirely.**

## Other vectors considered, and their status

- **`.gitmodules` / submodules** — `git merge` does not clone or init submodules, and no
  `--recurse-submodules` is passed. Not executed by the merge itself. Residual risk: a later
  `git submodule update` / clone in the landing repo or a fresh checkout would fetch and run
  the agent's URL. No such call exists in `src/` today (grep for `submodule` across `src/`
  returns nothing). **Not exploitable now; worth a deny-list before any checkout step is added.**
- **Symlinks** — the merge does not follow them. But a symlink committed as `../../cod/state.db`
  or similar is materialised, and any later host-side or container-side reader that opens that
  path follows it out of the worktree. `isGlobalPath` inspects only the `+++ b/` header, so a
  symlink pointing outside is not flagged. Medium — needs a follow-on reader to matter.
- **Crafted filenames** — `assertSafeName` (`src/worktree.ts:27,44-51`) rejects `..` and
  non-`[a-z0-9._-]` in work IDs, and that regex is applied to the job name before it becomes a
  path or branch (`worktree.ts:65-67`). Solid for the work ID path. Not verified this pass for
  every other id-to-path conversion.
- **Unusual object types** — a merge does not execute object content; it compares trees.
  Nothing found.

## Fix (in order of value)

1. Run the merge with **config isolation**, not just hook isolation. The strongest available
   control is to refuse any repo whose config declares a filter, plus:
   ```
   -c filter.pwn.clean=            # no
   ```
   Better: `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null` in the merge env, so
   neither the image's global identity nor anything an agent wrote to `~/.gitconfig` applies.
2. Make `.gitattributes` a **mechanical reject**. One line in `mechanicalChecks`: any added
   line matching `filter=` or `diff=` or `merge=` in a `.gitattributes` is refused before the
   model is asked. This is the check that actually closes it, because it does not depend on
   defending the config side.
3. Consider `git -c core.fsmonitor=false` and, ideally, landing into a **fresh clone** rather
   than the live `/work` checkout, so agent-written repo config cannot influence the merge at
   all.

The `-c core.hooksPath=/dev/null` guard in `land.ts` should be kept and the comment at
`land.ts:174-176` should stop implying it is sufficient — as written it invites exactly this
reasoning error.