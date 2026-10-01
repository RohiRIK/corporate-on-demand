# SEC-05 — Work-ID validation is solid; the unvalidated id→git-ref conversion is the gap (MEDIUM)

## Where

- `src/work.ts:209-213` — `SAFE_ID` / `assertSafeId`
- `src/work.ts:216-219, 274` — validation call sites
- `src/land.ts:86` — `const branch = `cod/${item.id}`;`
- `src/worktree.ts:27,44-51` — `SAFE` / `assertSafeName`

## The SAFE_ID check itself — sound

`assertSafeId` (`work.ts:211-213`) allows `[A-Za-z0-9._-]{1,64}`, and explicitly excludes `.`
and `..` — the two cases a character-class check alone would let through. It is called
eagerly at `propose()` (`work.ts:274`) so a bad id fails at creation rather than at write
time, and again at `writeWorkFile` (`work.ts:216`).

The containment assertion at `work.ts:222-225` is written oddly —

```ts
if (resolve(final).replace(resolvedDir, "") !== resolve(final).slice(resolvedDir.length))
```

`String.replace` with a string pattern replaces only the **first** occurrence anywhere in the
string, not a prefix. So this does not actually assert containment in general; it happens to
pass for the intended case because `resolvedDir` appears once at position 0. It is correct
today by coincidence of the input shape rather than by construction. `final.startsWith(resolvedDir + sep)` would be the assertion that means what the comment says. Low severity on its own (the regex already forbids separators, so `final` cannot escape), but it is a guard that would not catch what its comment claims if the regex were ever loosened.

## The gap — two different ID regexes for the same value

The work item id is validated by `SAFE_ID` (uppercase allowed, dot allowed, up to 64 chars).
The same value is then interpolated straight into a **git ref** at `land.ts:86`:

```ts
const branch = `cod/${item.id}`;
```

`SAFE_ID` permits a leading `-`? No — `[A-Za-z0-9._-]` does permit a leading `.` and a
leading `-`. `-foo` passes `SAFE_ID`. As a git ref, `refs/heads/cod/-foo` is legal, but
`refs/heads/cod/-foo` passed to a git command as a positional can be parsed as an **option**
(`git merge --no-ff -m msg cod/-foo` is fine, but `git diff master...cod/-foo` and
`git worktree add` argument positions vary). `worktree.ts` already anticipated this — its
`SAFE` (`worktree.ts:27`) requires `^[a-z0-9][a-z0-9._-]*$`, i.e. **first character
alphanumeric**, which is precisely the rule that prevents a leading `-`.

So there are two validators for one value with different rules, and the stricter one is only
applied on the worktree path. `land.ts:86` does not call `assertSafeName`, and `landWork` never
validates `item.id` at all — it trusts that `land.ts` was handed a well-formed item.

No shell is involved (`git()` at `land.ts:61-71` is `execFileSync` with argv), so this is
argument-injection risk, not command injection. Practical impact is likely low — `cod/` prefix
means the ref is never leading-dash — but the asymmetry is a real inconsistency and
`landWork` is a public export, so a caller that constructs a `WorkItem` by hand bypasses
`SAFE_ID` entirely.

## Other input→path/argument conversions surveyed

- `src/change.ts:25`, `src/landing.ts:25` — both `execFileSync("git", ["-C", repo, ...args])`.
  Argv arrays, no shell. Same shape as `land.ts`, same `-C`-then-args convention. Fine.
- `src/docker.ts:117` — `Bun.spawn([cmd, ...args])`, argv array. `cmd` is not validated in
  this function; it comes from the internal `Runner` type. Fine as used.
- `src/purge.ts:26` — `execFileSync("docker", [...args])`, argv array. Worth a follow-up read
  of what populates `args` (container names come from `safeSegment`, so the slug path is
  covered).
- **The only shell in `src/` is `agent.ts:71`.** Confirmed by grep across the whole tree for
  `execSync|execFileSync|spawnSync|Bun.spawn|exec(|shell:|-lc`: the sole `-lc` is SEC-01. That
  is a good structural result — the codebase overwhelmingly uses argv arrays.

## Symlink following

`work.ts` writes via `tmp` + `renameSync` (`work.ts:227-230`), which is atomic and does not
follow a symlink at the destination. Good. `openSync(tmp, "r")` then `fsyncSync` — fine.

No `readlink`/`realpath` validation of *inputs* was found anywhere: every path check in the
codebase is lexical (`resolve` + prefix compare), not symlink-aware. That is acceptable for
paths the system creates itself in a directory it owns, but it means a symlink an agent plants
inside `/work` (per SEC-02) is not detected by any check.

## Recommendation

1. Apply one ID validator. Either have `landWork` call `assertSafeName(item.id)` (stricter,
   already written, already tested) or widen `SAFE_ID` to require a leading alphanumeric.
2. Replace the `replace`/`slice` comparison at `work.ts:222-225` with a real
   `startsWith(resolvedDir + sep)` containment check.
3. Have `landWork` validate `item.id` rather than trusting its caller — it is exported and
   performs the one irreversible operation in the system.