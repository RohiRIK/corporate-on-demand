# SEC-03 — Git-as-execution-vector during the merge: the hook guard is bypassed by the worktree the branch itself owns

**Severity: SEVERE (blocking)**
**Locations: `src/land.ts:184-189` (the guarded merge), `src/land.ts:111` and `src/change.ts:25` (the *unguarded* git calls), `src/worktree.ts:84-91`**
**Class: CWE-78 / CWE-829 inclusion of functionality from an untrusted control sphere**

## What is already right

`src/land.ts:184-189` is careful and should be credited:

```ts
const merged = git(repo, [
  "-c", "core.hooksPath=/dev/null",
  "-c", "user.name=cod",
  "-c", "user.email=cod@localhost",
  "merge", "--no-ff", "-m", `cod: land ${branch}`, branch,
]);
```

`-c core.hooksPath=/dev/null` is the correct mitigation for pre-merge/post-merge hook execution, and the inline identity is right too (the comment records the four CI failures it fixed). The argv is a real array through `execFileSync` at `land.ts:63`, so no shell. That part is sound.

## The gap: the guard is applied to one call, and the branch owns more than hooks

**Finding A — `git diff` at `land.ts:111` runs with no guard at all.**
`const diff = git(repo, ["diff", \`master...${branch}\`])` goes through the same `execFileSync("git", [...])` helper but passes none of the `-c` flags. That is not merely inconsistent. `git diff` honours the branch's **`.gitattributes`**, and an agent that lands a `.gitattributes` naming a `diff=<driver>` gets its own external diff program selected by the repo config; `diff.external` and a configured textconv driver both cause git to execute an arbitrary program while producing this diff. This diff is then fed to `mechanicalChecks` and to the reviewer model at `land.ts:131` — so the injection point sits *before* the guarded merge, on every review.

`core.hooksPath` does not mitigate this class at all. It disables hooks; it does nothing about attributes, filters, or external diff drivers.

**Finding B — the same helper is reused by `change.ts:25` and `landing.ts:25`, also unguarded.**
`src/change.ts:45` runs `git diff --name-only ${base}..HEAD` in the agent's own worktree, and `src/landing.ts:25` wraps a further git call. Neither passes `core.hooksPath`. `src/worktree.ts:35` is a fourth, entirely separate `spawnSync("git", [...args], { cwd })` with no guard at all, and it runs `git worktree add` against the shared repo (`worktree.ts:91`).

**Finding C — this is the key structural point: the branch can commit a git config.**
The comment at `land.ts:174-177` says the `-c` flags stop "a branch that could add a pre-merge hook". The reasoning is that hooks arrive via `.git/hooks/` and `-c core.hooksPath` redirects them. That is correct for hooks *in the repo directory*. It does not cover:

- `.gitattributes` with `diff=`, `filter=`, or `merge=` drivers (Finding A), and
- the branch's ability to add a **submodule**, whose `.gitmodules` entry can point at a URL git will fetch — a network egress and an unpinned-code vector introduced by a diff that no mechanical check inspects, since `mechanicalChecks` only regexes added *lines* (`review.ts:65`) and `.gitmodules` lines look entirely ordinary.

The merge's guard is real but narrow, and it is the only place a guard exists.

## Impact

Code execution in the supervisor's process context at diff time, driven by content of the branch under review — i.e. the untrusted side of the review. The payload does not need to look like a hook or a secret; it needs to look like `.gitattributes`. `review.ts`'s `SECRET_PATTERNS` and `FORBIDDEN_ACTIONS` have no rule that fires on it, so the mechanical gate passes it cleanly and hands it to the model, which is advisory.

## Concrete correction

1. Apply the same guards at the `land.ts:111` diff, and to the `change.ts` / `landing.ts` / `worktree.ts` call sites — minimum `-c core.hooksPath=/dev/null`, plus `-c core.fsmonitor=false` and `-c diff.external=` (explicitly empty) on the diff call.
2. Better: stop using textual `git diff` as the security boundary at all. `readJobChange` (`change.ts:42`) already produces a `--name-only` path list, which is what the boundary decision should consume — the same root-cause fix as the global-path findings (deletes and renames are invisible to the text scan).
3. Add `diff=`, `filter=`, `submodule` and `.gitmodules` to the mechanical refusals, at minimum as SHOULD-FIX hardening. A diff that introduces an external driver or a submodule needs the CEO, exactly like a global path.
4. The claim in the `land.ts:174-177` comment should be corrected to state which vector it actually closes, so the next reader does not generalise from it.

## Verification performed

Read-only. `git diff` attribute/driver behaviour was established from the code path and git's documented semantics, not executed.