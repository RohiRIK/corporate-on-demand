# SEC-05 — Path validation: the work-id guard is sound, but `targetPaths` and the ledger payload are never validated and are trusted as paths

**Severity: SHOULD-FIX (one SEVERE sub-case if `cod work propose` is reachable by a non-operator)**
**Locations: `src/work.ts:209-214` and `:216-226` (sound), `src/runwork.ts:144-155` (`targetPathsOfItem`, unvalidated), `src/work.ts:297-301` (payload written verbatim), `src/work.ts:595-626` (`commit`, reason written verbatim)**
**Class: CWE-20 improper input validation / CWE-73 external control of file name or path**

## Finding A — `assertSafeId` / `writeWorkFile`: correct, and a good example

`work.ts:209` `SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/` with explicit `.`/`..` rejection, and it is enforced at *both* the write (`writeWorkFile`, `:217`) and the ingress (`propose`, `:274`). `worktree.ts:44-51` mirrors it for worktree/branch names. This is the right pattern and the comment at `:204-207` explains why. No finding.

Note for completeness: the "belt and braces" containment check at `work.ts:224` is dead code. `resolve(final).replace(resolvedDir, "")` is not a containment test — for any path under `resolvedDir` the replace removes the prefix and the comparison against `.slice(resolvedDir.length)` is tautologically equal, and for a path *outside* the directory the replace is a no-op and the two sides are also equal. It never throws. The regex is the entire guard. Harmless, but a comment claiming it "is the property that actually matters" (`work.ts:221-222`) is misleading, and a reader could delete the regex believing this covers it. NIT, but worth fixing while in the area.

## Finding B — `targetPathsOfItem` returns unvalidated strings that are treated as repository paths

`runwork.ts:144-155` parses `targetPaths` straight out of the payload and filters only `typeof p === "string"`. Those strings then flow to `isGlobalPath` (`boundary.ts:50`) and `describeWorkTarget` (`runwork.ts:66`).

The consequence is not file access — `normalise` (`boundary.ts:41-47`) strips a leading `/` and a `/work/` prefix, and `isGlobalPath` only does string matching, it never touches the filesystem. So no traversal write.

The real consequence is **authority classification by assertion**. `radiusForWork` (`runwork.ts:31-58`) derives the blast radius from these paths and returns 2 if any of them is global. An agent proposing work supplies its own `targetPaths`. `governance.ts:108` and `reconcile.ts:68` both rely on that derivation to keep global work away from departments. So the untrusted party picks the very list that decides whether the CEO is involved.

`boundary.ts:20-23` explicitly justifies segment-boundary matching so that "srcs/" is not "src/" — a good instinct — but it means the check is only ever as good as the path string, and the path string is agent-supplied. An agent that wants to touch `src/` without the CEO names `targetPaths: ["notes/a.md"]`. Nothing cross-checks the declared paths against what actually changed on disk.

Note that `readJobChange` (`change.ts:42`) *does* produce real changed paths, and `supervisor.ts:349-350` does classify them — but that result only sets a `refused` field on the result record (`:371`); it does not gate the dispatch. The derivation that decides authority and the measurement of what happened are two disconnected facts.

## Finding C — payload and reason are stored and re-emitted without length or content limits

`work.ts:298-301` stores `fields.payload` verbatim (wrapped in JSON only when target paths exist). `commit` (`:606`) writes `reason` verbatim, which is agent/model output (`land.ts:156` puts reviewer text there — see SEC-02). `land.ts:157` then reads `reason` back with a `startsWith("review")` heuristic and concatenates (`:154`), so an attacker-influenced `reason` can be made arbitrarily long and is then re-briefed to an agent.

Combined with SEC-02 this is the practical lever: an attacker who controls the payload gets unbounded model output executed through a shell on retry. Bounding `reason` (the reviewer path already truncates to 300 chars at `review.ts:157`, but the accumulated `priorReview` string at `land.ts:154-156` is not bounded) and bounding `payload` are cheap, independent mitigations.

## Concrete correction

1. Validate `targetPaths` in `propose` (`work.ts:259-289`) with the same `assertSafeName`-style rule used for ids: relative, no `..`, no absolute prefix, no leading `/`. It is a claim about repository paths, so it should be constrained as one.
2. More important: **stop deriving authority from an agent-supplied list alone.** Cross-check declared `targetPaths` against `readJobChange` output at dispatch time and refuse on disagreement — the measurement already exists and is already computed in `supervisor.ts:349`.
3. Cap `payload` and `reason` lengths, and cap the accumulated `priorReview` in `land.ts:154`.
4. Either make the `work.ts:224` containment check real (`if (!resolve(final).startsWith(resolvedDir + sep))`) or delete it and correct the comment.

## Verification performed

Read-only, by reading the call graph from `propose` → `targetPathsOfItem` → `radiusForWork` → `dispatchable`/`derivedRadius`. No payload was constructed and no file was written.